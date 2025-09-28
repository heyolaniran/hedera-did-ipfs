# Hedera DID & VC API

A Node.js application that provides REST API endpoints for managing Decentralized Identifiers (DIDs), issuing and verifying Verifiable Credentials (VCs), and integrating with Hedera Hashgraph and IPFS.

## Features

- Hedera Hashgraph integration using `@hashgraph/sdk`
- Verifiable Credentials management with `@transmute/vc.js`
- IPFS integration for decentralized storage
- Swagger API documentation
- JWT-based authentication
- Express.js REST API server

## Prerequisites

- Node.js (Latest LTS version recommended)
- IPFS node running locally or access to a remote IPFS gateway
- Hedera account credentials
- Environment variables properly configured

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd hedera
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```env
PORT=3000
IPFS_API_URL=http://localhost:5001
IPFS_API_KEY=your_ipfs_api_key  # Optional
# Add your Hedera account credentials
HEDERA_ACCOUNT_ID=your_account_id
HEDERA_PRIVATE_KEY=your_private_key
```

## Usage

Start the server:
```bash
npm start
```

The API will be available at `http://localhost:3000` (or your configured PORT).

API documentation (Swagger UI) will be available at `http://localhost:3000/api-docs`.

## API Endpoints

The API provides endpoints for:
- DID Creation and Management
- Verifiable Credential Issuance
- Verifiable Credential Verification
- IPFS Content Storage
- Hedera Topic Management

For detailed API documentation, please visit the Swagger UI endpoint after starting the server.

## Dependencies

- `@hashgraph/sdk`: Hedera Hashgraph SDK
- `@transmute/vc.js`: Verifiable Credentials toolkit
- `express`: Web framework
- `ipfs-http-client`: IPFS HTTP client
- `jsonwebtoken`: JWT implementation
- `swagger-jsdoc` & `swagger-ui-express`: API documentation
- `dotenv`: Environment configuration
- `uuid`: Unique identifier generation

## License

MIT

