# Mission System
The Mission system provides a comprehensive framework for managing Star Citizen missions with cryptographic verification using **secp256k1** signatures for individual contracts and **Musig2** for multisig team missions.

## Overview

The Mission module enables:
- ✅ Mission creation and lifecycle management
- ✅ Application submission with cryptographic signatures
- ✅ Single signature contracts (secp256k1 + ephemeral keys)
- ✅ Multisig contracts (Musig2 compatible)
- ✅ Discord integration for mission announcements
- ✅ Sensemaker UI integration
- ✅ RESTful HTTP API
- ✅ Declarative API properties

## Architecture

### Core Components

1. **Mission** (`types/Mission.js`) - Mission entity with contract configuration
2. **MissionApplication** (`types/MissionApplication.js`) - Application with signature data
3. **MissionManager** (`services/MissionManager.js`) - Service managing missions and signatures
4. **MissionHome** (`components/MissionHome.js`) - Sensemaker UI component

### Integration

The Mission system integrates with the StarCitizen service:

```javascript
const StarCitizen = require('@rsi/star-citizen');

const sc = new StarCitizen({
  missions: {
    enable: true,
    enableMusig2: true,
    autoApprove: false,
    maxApplicationsPerMission: 10
  }
});

// Access via declarative API
console.log(sc.missions);           // All missions
console.log(sc.applications);       // All applications
```

## Mission Types

### Single Signature (secp256k1)

Individual missions where a player signs with their ephemeral contract key.

**Contract Configuration:**
```javascript
{
  type: 'single',
  authorizedSigners: null // Any valid signature accepted
}
```

**Application Process:**
1. Player generates ephemeral secp256k1 key pair
2. Mission generates contract commitment (sha256 hash)
3. Player signs commitment with private key
4. Submit application with signature and public key
5. Service verifies signature
6. Application approved if valid

### Multisig (Musig2)

Team missions requiring multiple participants to sign cooperatively.

**Contract Configuration:**
```javascript
{
  type: 'multisig',
  requiredSignatures: 3,
  authorizedSigners: [
    'pubkey1_hex',
    'pubkey2_hex',
    'pubkey3_hex',
    'pubkey4_hex'
  ]
}
```

**Application Process:**
1. Team members generate their secp256k1 key pairs
2. Participants perform Musig2 key aggregation
3. Mission generates contract commitment
4. Each participant creates partial signature
5. Partial signatures aggregated into final signature
6. Submit application with aggregated signature and multisig data
7. Service verifies Musig2 signature
8. Application approved if threshold met

## API Reference

### Declarative Properties

```javascript
const sc = new StarCitizen(config);

// Mission properties
sc.missions                 // Array<Mission> - All missions
sc.applications      // Array<MissionApplication> - All applications
```

### HTTP Endpoints

#### Missions

```bash
# List all missions
GET /services/star-citizen/missions
GET /services/star-citizen/missions?status=open

# Create mission
POST /services/star-citizen/missions
{
  "title": "Bounty: Clear Outpost",
  "description": "Eliminate pirates at Station X",
  "type": "bounty",
  "reward": 50000,
  "requirements": {
    "minReputation": 3,
    "skills": ["combat"],
    "vehicleType": "fighter"
  },
  "location": {
    "system": "Stanton",
    "planet": "Crusader"
  },
  "contract": {
    "type": "single"
  },
  "issuer": "player-123",
  "expiresAt": 1735689600000
}

# Get mission details
GET /services/star-citizen/missions/:id

# Complete mission
POST /services/star-citizen/missions/:id/complete
{
  "completionProof": "..."
}

# Fail mission
POST /services/star-citizen/missions/:id/fail
{
  "reason": "Objective failed"
}
```

#### Applications

```bash
# List mission applications
GET /services/star-citizen/missions/:id/applications

# Submit application (single signature)
POST /services/star-citizen/missions/:id/applications
{
  "applicantId": "player-456",
  "publicKey": "03a1b2c3...",
  "signature": "304502...",
  "message": "Ready for deployment"
}

# Submit application (multisig)
POST /services/star-citizen/missions/:id/applications
{
  "applicantId": "team-789",
  "publicKey": "aggregated_key_hex",
  "signature": "musig2_signature_hex",
  "message": "Team ready",
  "multisigData": {
    "participantKeys": [
      "03a1b2c3...",
      "03d4e5f6...",
      "03g7h8i9..."
    ],
    "aggregatedKey": "03xyz...",
    "nonces": [
      { "public": "...", "commitment": "..." },
      { "public": "...", "commitment": "..." }
    ]
  }
}

# Approve application
POST /services/star-citizen/applications/:id/approve

# Reject application
POST /services/star-citizen/applications/:id/reject
{
  "reason": "Does not meet requirements"
}
```

## Usage Examples

### Creating a Mission

```javascript
const mission = await sc.missionManager.createMission({
  title: 'Escort Cargo Transport',
  description: 'Protect Hull-C from Stanton to Terra',
  type: 'escort',
  reward: 100000,
  requirements: {
    minReputation: 5,
    vehicleType: 'fighter'
  },
  location: {
    system: 'Stanton',
    planet: 'Port Olisar'
  },
  contract: {
    type: 'single'
  },
  issuer: 'npc-merchant-001',
  expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
});

console.log('Mission created:', mission.id);
```

### Submitting Single Signature Application

```javascript
const secp256k1 = require('@fabric/core/lib/secp256k1');
const crypto = require('crypto');

// Generate ephemeral key
const privateKey = secp256k1.generatePrivateKey();
const publicKey = secp256k1.publicKeyCreate(privateKey);

// Get mission and generate commitment
const mission = sc.missionManager.getMission('mission-123');
const commitment = mission.generateContractCommitment();

// Sign commitment
const commitmentBuffer = Buffer.from(commitment, 'hex');
const signature = secp256k1.sign(commitmentBuffer, privateKey);

// Submit application
const application = await sc.missionManager.submitApplication({
  missionId: 'mission-123',
  applicantId: 'player-456',
  publicKey: publicKey.toString('hex'),
  signature: signature.toString('hex'),
  message: 'Experienced pilot ready'
});

console.log('Application submitted:', application.id);
console.log('Verified:', application.verified);
```

### Submitting Musig2 Application

```javascript
// Team members generate keys
const team = [
  { id: 'player-1', privateKey: secp256k1.generatePrivateKey() },
  { id: 'player-2', privateKey: secp256k1.generatePrivateKey() },
  { id: 'player-3', privateKey: secp256k1.generatePrivateKey() }
];

// Get public keys
const publicKeys = team.map(member =>
  secp256k1.publicKeyCreate(member.privateKey)
);

// Aggregate keys (Musig2 key aggregation)
// Note: Use proper Musig2 library in production
const aggregatedKey = musig2.aggregateKeys(publicKeys);

// Get mission commitment
const mission = sc.missionManager.getMission('mission-456');
const commitment = mission.generateContractCommitment();

// Generate nonces (Musig2 protocol)
const nonces = team.map(member => musig2.generateNonce());

// Create partial signatures
const partialSignatures = team.map((member, i) =>
  musig2.partialSign(
    Buffer.from(commitment, 'hex'),
    member.privateKey,
    aggregatedKey,
    nonces
  )
);

// Aggregate signatures
const finalSignature = musig2.aggregateSignatures(partialSignatures);

// Submit application
const application = await sc.missionManager.submitApplication({
  missionId: 'mission-456',
  applicantId: 'team-789',
  publicKey: aggregatedKey.toString('hex'),
  signature: finalSignature.toString('hex'),
  message: 'Team assembled and ready',
  multisigData: {
    participantKeys: publicKeys.map(k => k.toString('hex')),
    aggregatedKey: aggregatedKey.toString('hex'),
    nonces: nonces.map(n => ({
      public: n.public.toString('hex'),
      commitment: n.commitment.toString('hex')
    }))
  }
});
```

## Events

The Mission system emits the following events:

```javascript
// Mission events
sc.on('mission:created', (mission) => {
  console.log('New mission:', mission.title);
});

sc.on('mission:completed', (mission) => {
  console.log('Mission completed:', mission.id);
  console.log('Reward:', mission.reward);
});

sc.on('mission:failed', (mission) => {
  console.log('Mission failed:', mission.id);
  console.log('Reason:', mission.failureReason);
});

// Application events
sc.on('application:submitted', (application) => {
  console.log('New application:', application.id);
  console.log('Signature verified:', application.verified);
  console.log('Multisig:', application.isMultisig);
});

sc.on('application:approved', (application) => {
  console.log('Application approved:', application.id);
  console.log('Applicant:', application.applicantId);
});

sc.on('application:rejected', (application) => {
  console.log('Application rejected:', application.id);
  console.log('Reason:', application.rejectionReason);
});
```

## Discord Integration

Mission events automatically post to Discord when enabled:

```javascript
const sc = new StarCitizen({
  discord: {
    enable: true,
    webhook: 'YOUR_WEBHOOK_URL'
  },
  missions: {
    enable: true
  }
});
```

**Discord Announcements:**

- 📋 **Mission Created** (Green) - New mission available
- ✅ **Mission Completed** (Blue) - Mission successfully completed
- ❌ **Mission Failed** (Red) - Mission failed
- 📝 **Application Submitted** (Yellow) - New application received
- ✅ **Application Approved** (Green) - Application accepted
- ❌ **Application Rejected** (Red) - Application denied

Each announcement includes mission details, reward, contract type, and status.

## Sensemaker Integration

### Add to Dashboard Routes

```javascript
// In components/Dashboard.js
const MissionHome = require('@rsi/star-citizen/components/MissionHome');

<Route
  path='/services/star-citizen/missions'
  element={
    <MissionHome
      {...props}
      missions={props.starCitizen.missions}
      loading={props.starCitizen.loading}
      fetchMissions={props.fetchMissions}
    />
  }
/>
```

### Redux Actions

```javascript
export const fetchMissions = () => async (dispatch) => {
  dispatch({ type: 'FETCH_MISSIONS_REQUEST' });

  try {
    const response = await fetch('/services/star-citizen/missions');
    const data = await response.json();

    dispatch({
      type: 'FETCH_MISSIONS_SUCCESS',
      payload: data.data
    });
  } catch (error) {
    dispatch({
      type: 'FETCH_MISSIONS_FAILURE',
      error: error.message
    });
  }
};
```

## Security Considerations

### Signature Verification

- All signatures verified using secp256k1
- Invalid signatures rejected immediately
- Replay attacks prevented via timestamp in commitment
- Commitment includes mission-specific data

### Ephemeral Keys

- Contract keys should be ephemeral (one-time use)
- Never reuse keys across missions
- Store private keys securely (encrypted storage)
- Clear keys after mission completion

### Musig2 Security

- All participants must verify aggregated key
- Nonce commitment prevents key cancellation attacks
- Use deterministic nonce generation
- Verify partial signatures before aggregation
- Implement proper timeout handling

### Authorization

- Check applicant meets mission requirements
- Verify authorized signers for multisig
- Implement reputation system
- Rate limit application submissions

## Testing

```bash
# Run mission system tests
npm test tests/missions.js

# Test single signature flow
npm test tests/missions-single-sig.js

# Test multisig flow
npm test tests/missions-multisig.js
```

## Future Enhancements

- [ ] Threshold signature schemes (t-of-n)
- [ ] Schnorr signature support
- [ ] BLS signature aggregation
- [ ] Mission templates and categories
- [ ] Reputation-based mission access
- [ ] Mission chains (sequential missions)
- [ ] Reward escrow system
- [ ] On-chain mission verification
- [ ] Cross-organization missions
- [ ] Mission marketplace

## References

- [secp256k1 Specification](https://www.secg.org/sec2-v2.pdf)
- [Musig2 Paper](https://eprint.iacr.org/2020/1261)
- [Bitcoin secp256k1 Library](https://github.com/bitcoin-core/secp256k1)
- [Fabric Core Documentation](https://github.com/FabricLabs/fabric)

## Support

For issues, questions, or contributions related to the Mission system:
- GitHub Issues: https://github.com/GoonCitizen/star-citizen-live/issues
- Discord: [Join our community]
- Email: support@fabric.pub

