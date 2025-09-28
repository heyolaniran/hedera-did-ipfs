require('dotenv').config();
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const { Client, AccountId, PrivateKey, TopicId, TopicMessageSubmitTransaction, Hbar, AccountInfoQuery, AccountBalanceQuery, AccountCreateTransaction } = require('@hashgraph/sdk');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
// ipfs-http-client is ESM-only; use lazy dynamic import to work in CommonJS
let ipfsInstance = null;
async function getIpfs() {
    if (!ipfsInstance) {
        const { create } = await import('ipfs-http-client');
        ipfsInstance = create({
            url: process.env.IPFS_API_URL || 'http://localhost:5001',
            headers: process.env.IPFS_API_KEY ? { authorization: `Bearer ${process.env.IPFS_API_KEY}` } : {}
        });
    }
    return ipfsInstance;
}
const crypto = require('crypto');
const { type } = require('os');


// start App

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Swagger setup
const swaggerDefinition = {
    openapi: '3.0.3',
    info: {
        title: 'Hedera DID & VC API',
        version: '1.0.0',
        description: 'API for creating DIDs, issuing and verifying verifiable credentials, and IPFS/Hedera anchoring.'
    },
    servers: [
        { url: `http://localhost:${process.env.PORT || 3000}`, description: 'Local server' }
    ]
};

const swaggerOptions = {
    swaggerDefinition,
    apis: [__filename]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const client = Client.forTestnet();
client.setOperator(AccountId.fromString(process.env.HEDERA_ACCOUNT_ID), PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY));

// IPFS client will be created on first use via getIpfs()

// HCS Topic for anchoring

const topicId = TopicId.fromString(process.env.HEDERA_TOPIC_ID);


// Hospital DID and key from /create-did

const ISSUER_DID = 'did:hedera:0.0.your-hospital-account';  // e.g., from previous creation
const ISSUER_PRIVATE_KEY = PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY);  // Use hospital key
const ISSUER_PUBLIC_KEY = ISSUER_PRIVATE_KEY.publicKey;


// create did endpoint
/**
 * @openapi
 * /create-did:
 *   post:
 *     summary: Create a new Hedera account and DID
 *     description: Generates a new Hedera account with an initial balance and returns DID, keys and account ID.
 *     tags:
 *       - DID
 *     responses:
 *       200:
 *         description: DID created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     accountId:
 *                       type: string
 *                     privateKey:
 *                       type: string
 *                     did:
 *                       type: string
 *                     publicKey:
 *                       type: string
 *       500:
 *         description: Internal server error
 */

async function createNewAccount() {
    const newKey = await PrivateKey.generateECDSAAsync();
    const newAccount = await new AccountCreateTransaction()
        .setKey(newKey.publicKey)
        .setInitialBalance(new Hbar(10)) // 10 HBAR initial balance for testing
        .execute(client);
    const newAccountReceipt = await newAccount.getReceipt(client);
    const newAccountId = newAccountReceipt.accountId;
    return {
        accountId: newAccountId.toString(),
        privateKey: newKey.toStringDer(),
        did: `did:hedera:${newAccountId.toString()}`,
        publicKey: newKey.publicKey.toStringDer()
    };
}


app.post('/create-did', async (req, res) => {
    try {
        const result = await createNewAccount();

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error creating DID:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// resolve DID endpoint
/**
 * @openapi
 * /resolve-did/{did}:
 *   get:
 *     summary: Resolve a Hedera DID
 *     description: Retrieves DID document-like information and account state for a given DID.
 *     tags:
 *       - DID
 *     parameters:
 *       - in: path
 *         name: did
 *         schema:
 *           type: string
 *         required: true
 *         description: DID to resolve, e.g., did:hedera:0.0.xxxxx
 *     responses:
 *       200:
 *         description: DID resolved successfully
 *       400:
 *         description: Invalid DID or error during resolution
 */

async function resolveDID(did) {
    if (!did.startsWith('did:hedera:')) {
        throw new Error('Invalid DID format');
    }

    const accountIdStr = did.split(':')[2];
    const accountId = AccountId.fromString(accountIdStr);

    // get account info from Hedera
    const accountInfo = await new AccountInfoQuery()
        .setAccountId(accountId)
        .execute(client);

    // get account balance
    const accountBalance = await new AccountBalanceQuery()
        .setAccountId(accountId)
        .execute(client);

    return {
        did: did,
        accountId: accountIdStr,
        publicKey: accountInfo.key.toString(),
        balance: accountBalance.hbars.toString(),
        didDocument: {
            '@context': 'https://www.w3.org/ns/did/v1',
            id: did,
            verificationMethod: [
                {
                    id: `${did}#key-1`,
                    type: 'EcdsaSecp256r1VerificationKey2019',
                    publicKeyBase58: accountInfo.key.toString()
                }
            ]
        }
    };
}

app.get('/resolve-did/:did', async (req, res) => {
    const { did } = req.params;
    try {
        const result = await resolveDID(did);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error resolving DID:', error);
        res.status(400).json({ success: false, message: error.message });
    }
});

// Helper store document on IPFS 

async function storeOnIPFS(document) {
    const ipfs = await getIpfs();
    const resut = await ipfs.add(JSON.stringify(document));
    return resut.cid.toString();
}

// Helper : anchor Data on HCS (CID + Hash)

async function anchorOnHCS(data) {
    const message = Buffer.from(JSON.stringify(data));
    const tx = await new TopicMessageSubmitTransaction({ topicId, message }).execute(client);
    const receipt = await tx.getReceipt(client);

    if (receipt.status.toString() !== 'SUCCESS') {
        throw new Error('Failed to anchor data on HCS');
    }

    return receipt;
}

// helper : create and sign verifiable credential 

async function createSignedVC(credential, issuerDID, issuerPrivateKey) {
    const vcId = `urn:uuid:${uuidv4()}`;
    const issuedAt = new Date().toISOString();

    // Basic VC structure (based on W3C VC Data Model - FHIR inspired for medical use cases)

    const vcPayload = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id: vcId,
        type: ['VerifiableCredential', 'HealthCredential'],
        issuer: { id: issuerDID },
        issuanceDate: issuedAt,
        credentialSubject: {
            id: credential.patientDID,
            prescription: {
                ...credential.document
            }
        }
    }

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(vcPayload)).digest();

    // Sign with Hedera Priv Key (ECDSA)

    const signature = await issuerPrivateKey.sign(payloadHash);

    // Attach proof

    const signedVC = {
        ...vcPayload,
        proof: {
            type: 'EcdsaSecp256r1Signature2019',
            created: issuedAt,
            proofPurpose: 'assertionMethod',
            verificationMethod: `${issuerDID}#key-1`,
            jws: signature.toStringRaw()
        }
    }

    // Optional: Wrap as JWT for Portability (using jsonwebtoken with ES256K)
    try {
        // Convert Hedera key to PEM for JWT (simplified; use a lib like 'secp256k1' if needed)
        const jwtPayload = { vc: signedVC };
        const jwtOptions = { algorithm: 'ES256K', issuer: issuerDID, expiresIn: '1y' };
        // Note: jsonwebtoken needs PEM keys; convert Hedera key:
        const pemPrivateKey = issuerPrivateKey.toStringDer().toString('base64');  // Adapt as needed; may require extra lib
        // For simplicity, we'll skip full JWT here and use the signed JSON. Add 'secp256k1' npm if JWT is critical.
    } catch (jwtError) {
        console.warn('JWT wrapping skipped:', jwtError.message);
    } finally {
        return signedVC; // Return signed VC JSON
    }

}

// Helper : Verify Signed VC

async function verifySignedVC(signedVC, expectedIssuerDID) {

    const { proof, ...vcPayload } = signedVC;

    if (!proof || !proof.jws || proof.verificationMethod !== `${expectedIssuerDID}#key-1`) {
        throw new Error('Missing proof in VC');
    }

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(vcPayload)).digest();

    const publicKey = resolveDID(expectedIssuerDID).then(res => res.publicKey);

    const isValid = await publicKey.verify(payloadHash, Buffer.from(proof.jws, 'base64'));

    return { verified: isValid, vc: signedVC };
}


// POST /issue-medical-vc
/**
 * @openapi
 * /issue-medical-vc:
 *   post:
 *     summary: Issue a signed medical Verifiable Credential
 *     description: Stores the medical document on IPFS, anchors its hash and CID on Hedera HCS, then returns a signed VC.
 *     tags:
 *       - Verifiable Credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               patientDID:
 *                 type: string
 *                 example: did:hedera:0.0.1234
 *               document:
 *                 type: object
 *                 example: { diagnosis: "Flu", medication: "Tamiflu", dosage: "75mg twice daily for 5 days", date: "2025-09-28" }
 *     responses:
 *       200:
 *         description: VC issued successfully
 *       400:
 *         description: Missing parameters
 *       500:
 *         description: Internal server error
 */

/**
 * 
 * Body parameters:
 * - patientDID: string (DID of the patient, e.g., 'did:hedera:0.0.xxxxx')
 * - document: object (the medical document to include in the VC, e.g., prescription details) : {diagnosis: "Flu", medication: "Tamiflu", dosage: "75mg twice daily for 5 days", date: "2025-09-28"}
 */

app.post('/issue-medical-vc', async (req, res) => {

    try {
        const { patientDID, document } = req.body;

        if (!patientDID || !document) {
            return res.status(400).json({ success: false, message: 'Missing patientDID or document in request body' });
        }

        const cid = await storeOnIPFS(document);
        const documentHash = crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');

        // Anchor on HCS
        const anchorData = {
            cid,
            documentHash,
            patientDID,
            type: 'medical-document',
            timestamp: new Date().toISOString()
        };

        await anchorOnHCS(anchorData);

        // Create and sign VC
        const vc = await createSignedVC({ patientDID, document: { ...document, ipfsCid: cid, hash: documentHash } }, ISSUER_DID, ISSUER_PRIVATE_KEY);

        res.json({
            success: true,
            data: {
                signedVC,
                cid,
                patientDID,
                message: 'Medical VC issued, anchored on HCS and document stored on IPFS'
            }
        })
    } catch (error) {
        console.error("Error message : ", error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal Server Error'
        })
    }
})


// Get /verify-vc
/**
 * @openapi
 * /verify-vc:
 *   get:
 *     summary: Verify a signed Verifiable Credential
 *     description: Verifies VC signature and optionally fetches associated document from IPFS if CID is present.
 *     tags:
 *       - Verifiable Credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               signedVC:
 *                 type: object
 *               issuerDID:
 *                 type: string
 *     responses:
 *       200:
 *         description: VC verified successfully
 *       400:
 *         description: Missing parameters or verification failed
 *       500:
 *         description: Internal server error
 */

/**
 * Body parameters:
 * - signedVC: object (the signed VC to verify)
 * - expectedIssuerDID: string (the expected issuer DID to validate against)
 * 
 */

app.get('/verify-vc', async (req, res) => {

    try {
        const { signedVC, issuerDID } = req.body;

        if (!signedVC || !issuerDID) {
            return res.status(400).json({ success: false, message: 'Missing signedVC or issuerDID in request body' });
        }

        const verification = await verifySignedVC(signedVC, issuerDID);

        if (verification.verified) {
            const cid = signedVC.credentialSubject.prescription.ipfsCid;
            let document = null

            if (cid) {
                const ipfs = await getIpfs();
                const chunks = [];
                for await (const chunk of ipfs.cat(cid)) {
                    chunks.push(chunk);
                }
                document = JSON.parse(Buffer.concat(chunks).toString());
            }

            res.json({
                success: true,
                data: {
                    verified: true,
                    vc: verification.vc,
                    document
                }
            })
        } else {
            res.status(400).json({ success: false, message: 'VC signature verification failed' });
        }


    } catch (error) {
        console.error("Error verifying VC: ", error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }

})


// Start server

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});