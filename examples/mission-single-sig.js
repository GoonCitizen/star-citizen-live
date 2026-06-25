#!/usr/bin/env node
'use strict';

/**
 * Example: Single Signature Mission Application
 *
 * Demonstrates how to create a mission and submit an application
 * using secp256k1 signature with ephemeral contract key.
 */

const StarCitizen = require('../services/StarCitizen');
// Use tiny-secp256k1 directly (same as @fabric/core uses)
const secp256k1 = require('tiny-secp256k1');

async function main () {
  // Create service with missions enabled
  const sc = new StarCitizen({
    name: 'Mission Demo (Single Sig)',
    missions: {
      enable: true,
      enableMusig2: false,
      autoApprove: false
    },
    discord: {
      enable: false
    },
    http: {
      enable: false
    }
  });

  console.log('[DEMO]', '=== Single Signature Mission Demo ===\n');

  await sc.start();

  // Create a mission
  console.log('[DEMO]', '1. Creating mission...');
  const mission = await sc.missionManager.createMission({
    title: 'Bounty: Eliminate Pirate Leader',
    description: 'Track down and eliminate the notorious pirate captain "Blackbeard"',
    type: 'bounty',
    reward: 75000,
    requirements: {
      minReputation: 3,
      skills: ['combat', 'tracking'],
      vehicleType: 'fighter'
    },
    location: {
      system: 'Stanton',
      planet: 'Crusader'
    },
    contract: {
      type: 'single'
    },
    issuer: 'advocacy-officer-001',
    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
  });

  console.log('[DEMO]', 'Mission created:', mission.id);
  console.log('[DEMO]', 'Title:', mission.title);
  console.log('[DEMO]', 'Reward:', mission.reward, 'UEC');
  console.log('[DEMO]', 'Contract type:', mission.contract.type);
  console.log('');

  // Generate ephemeral key for contract
  console.log('[DEMO]', '2. Generating ephemeral contract key...');
  const crypto = require('crypto');
  const privateKey = crypto.randomBytes(32);
  const publicKey = secp256k1.pointFromScalar(privateKey, true);

  console.log('[DEMO]', 'Private key:', privateKey.toString('hex').substring(0, 16) + '...');
  console.log('[DEMO]', 'Public key:', publicKey.toString('hex'));
  console.log('');

  // Generate contract commitment
  console.log('[DEMO]', '3. Generating contract commitment...');
  const commitment = mission.generateContractCommitment();
  console.log('[DEMO]', 'Commitment:', commitment);
  console.log('');

  // Sign the commitment
  console.log('[DEMO]', '4. Signing commitment with private key...');
  const commitmentHash = crypto.createHash('sha256')
    .update(Buffer.from(commitment, 'hex'))
    .digest();
  const signature = secp256k1.sign(commitmentHash, privateKey);

  console.log('[DEMO]', 'Signature:', signature.toString('hex').substring(0, 32) + '...');
  console.log('');

  // Verify signature (optional, service will do this)
  console.log('[DEMO]', '5. Verifying signature (client-side check)...');
  const verified = secp256k1.verify(commitmentHash, publicKey, signature);
  console.log('[DEMO]', 'Signature valid:', verified);
  console.log('');

  // Submit application
  console.log('[DEMO]', '6. Submitting application...');
  try {
    const application = await sc.missionManager.submitApplication({
      missionId: mission.id,
      applicantId: 'player-bounty-hunter-001',
      publicKey: publicKey.toString('hex'),
      signature: signature.toString('hex'),
      message: 'Experienced bounty hunter. 50+ successful captures.'
    });

    console.log('[DEMO]', 'Application submitted:', application.id);
    console.log('[DEMO]', 'Status:', application.status);
    console.log('[DEMO]', 'Verified by service:', application.verified);
    console.log('[DEMO]', 'Message:', application.message);
    console.log('');

    // Check mission state
    console.log('[DEMO]', '7. Checking mission applications...');
    const applications = sc.missionManager.getMissionApplications(mission.id);
    console.log('[DEMO]', 'Total applications:', applications.length);
    console.log('');

    // Approve application
    console.log('[DEMO]', '8. Approving application...');
    const approved = await sc.missionManager.approveApplication(application.id);
    console.log('[DEMO]', 'Application approved');
    console.log('[DEMO]', 'Mission status:', sc.missionManager.getMission(mission.id).status);
    console.log('[DEMO]', 'Assignee:', sc.missionManager.getMission(mission.id).assignee);
    console.log('');

    // Complete mission
    console.log('[DEMO]', '9. Completing mission...');
    const completed = await sc.missionManager.completeMission(mission.id, {
      targetEliminated: true,
      bountyCollected: true,
      location: 'Crusader Station'
    });
    console.log('[DEMO]', 'Mission completed!');
    console.log('[DEMO]', 'Final status:', completed.status);
    console.log('[DEMO]', 'Reward earned:', completed.reward, 'UEC');
    console.log('');

    // Show final stats
    console.log('[DEMO]', '=== Final Statistics ===');
    console.log('[DEMO]', 'Total missions:', sc.missions.length);
    console.log('[DEMO]', 'Open missions:', sc.missions.filter(m => m.status === 'open').length);
    console.log('[DEMO]', 'Completed missions:', sc.missions.filter(m => m.status === 'completed').length);
    console.log('[DEMO]', 'Total applications:', sc.applications.length);

  } catch (error) {
    console.error('[DEMO]', 'Error:', error.message);
  }

  await sc.stop();
  console.log('\n[DEMO]', 'Demo complete!');
  process.exit(0);
}

// Run the demo
if (require.main === module) {
  main().catch((error) => {
    console.error('[DEMO]', 'Fatal error:', error);
    process.exit(1);
  });
}

module.exports = main;

