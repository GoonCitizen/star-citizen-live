> ⚠️ **STALE — legacy Fabric API.** This file is auto-generated JSDoc for the
> **original Fabric-based code** (`StarCitizen ⇐ Hub`, `Mission ⇐ Entity`,
> `MissionApplication`) that this fork **removed** (see `DECISIONS.md` → D-002).
> It does **not** describe the current Fabric-free service. There is no longer a
> generator script for it.
>
> **For the real, current REST API and architecture, see `AGENTS.md` §4** (and
> `README.md` → REST API). This file is retained only for historical reference
> during the migration.

## Classes

<dl>
<dt><a href="#Mission">Mission</a> ⇐ <code>Entity</code></dt>
<dd><p>Represents a Mission in the Star Citizen universe.
Missions can be accepted by signing with secp256k1 or Musig2 multisig.</p>
</dd>
<dt><a href="#MissionApplication">MissionApplication</a> ⇐ <code>Entity</code></dt>
<dd><p>Represents an application to accept a Mission.</p>
</dd>
<dt><a href="#MissionManager">MissionManager</a></dt>
<dd><p>Mission Manager service.
Handles mission lifecycle, applications, and cryptographic verification.
Supports both single secp256k1 signatures and Musig2 multisig.</p>
</dd>
<dt><a href="#StarCitizen">StarCitizen</a> ⇐ <code>Hub</code></dt>
<dd><p>Core service for Star Citizen.
Provides a Fabric-compatible declarative API with Discord integration.</p>
</dd>
</dl>

## Typedefs

<dl>
<dt><a href="#StarCitizenActivity">StarCitizenActivity</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenPlayer">StarCitizenPlayer</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenVehicle">StarCitizenVehicle</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenKill">StarCitizenKill</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenLogEntry">StarCitizenLogEntry</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#DiscordConfig">DiscordConfig</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#StarCitizenSettings">StarCitizenSettings</a> : <code>Object</code></dt>
<dd></dd>
</dl>

## Interfaces

<dl>
<dt><a href="#StarCitizenAPI">StarCitizenAPI</a></dt>
<dd><p>Declarative API interface for Star Citizen Live service.</p>
<p>This interface defines the properties and methods exposed by the
StarCitizen service for programmatic access to game data.</p>
</dd>
</dl>

<a name="StarCitizenAPI"></a>

## StarCitizenAPI
Declarative API interface for Star Citizen Live service.

This interface defines the properties and methods exposed by the
StarCitizen service for programmatic access to game data.

**Kind**: global interface  

* [StarCitizenAPI](#StarCitizenAPI)
    * [.activities](#StarCitizenAPI+activities) ⇒ [<code>Array.&lt;StarCitizenActivity&gt;</code>](#StarCitizenActivity)
    * [.players](#StarCitizenAPI+players) ⇒ [<code>Array.&lt;StarCitizenPlayer&gt;</code>](#StarCitizenPlayer)
    * [.vehicles](#StarCitizenAPI+vehicles) ⇒ [<code>Array.&lt;StarCitizenVehicle&gt;</code>](#StarCitizenVehicle)
    * [.kills](#StarCitizenAPI+kills) ⇒ [<code>Array.&lt;StarCitizenKill&gt;</code>](#StarCitizenKill)
    * [.logs](#StarCitizenAPI+logs) ⇒ [<code>Array.&lt;StarCitizenLogEntry&gt;</code>](#StarCitizenLogEntry)
    * [.status](#StarCitizenAPI+status) ⇒ <code>String</code>
    * [.postToDiscord(payload)](#StarCitizenAPI+postToDiscord) ⇒ <code>Promise.&lt;Response&gt;</code>
    * [.announceActivity(activity)](#StarCitizenAPI+announceActivity) ⇒ <code>Promise.&lt;Response&gt;</code>
    * [.screenshot()](#StarCitizenAPI+screenshot) ⇒ <code>Promise.&lt;Buffer&gt;</code>
    * [.start()](#StarCitizenAPI+start) ⇒ [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI)
    * [.stop()](#StarCitizenAPI+stop) ⇒ [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI)

<a name="StarCitizenAPI+activities"></a>

### starCitizenAPI.activities ⇒ [<code>Array.&lt;StarCitizenActivity&gt;</code>](#StarCitizenActivity)
Get all activities.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenActivity&gt;</code>](#StarCitizenActivity) - Array of activities  
<a name="StarCitizenAPI+players"></a>

### starCitizenAPI.players ⇒ [<code>Array.&lt;StarCitizenPlayer&gt;</code>](#StarCitizenPlayer)
Get all players.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenPlayer&gt;</code>](#StarCitizenPlayer) - Array of players  
<a name="StarCitizenAPI+vehicles"></a>

### starCitizenAPI.vehicles ⇒ [<code>Array.&lt;StarCitizenVehicle&gt;</code>](#StarCitizenVehicle)
Get all vehicles.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenVehicle&gt;</code>](#StarCitizenVehicle) - Array of vehicles  
<a name="StarCitizenAPI+kills"></a>

### starCitizenAPI.kills ⇒ [<code>Array.&lt;StarCitizenKill&gt;</code>](#StarCitizenKill)
Get all kills.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenKill&gt;</code>](#StarCitizenKill) - Array of kill events  
<a name="StarCitizenAPI+logs"></a>

### starCitizenAPI.logs ⇒ [<code>Array.&lt;StarCitizenLogEntry&gt;</code>](#StarCitizenLogEntry)
Get all log entries.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Array.&lt;StarCitizenLogEntry&gt;</code>](#StarCitizenLogEntry) - Array of log entries  
<a name="StarCitizenAPI+status"></a>

### starCitizenAPI.status ⇒ <code>String</code>
Get service status.

**Kind**: instance property of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: <code>String</code> - Current status ('STOPPED', 'STARTING', 'STARTED', 'STOPPING')  
<a name="StarCitizenAPI+postToDiscord"></a>

### starCitizenAPI.postToDiscord(payload) ⇒ <code>Promise.&lt;Response&gt;</code>
Post a message to Discord via webhook.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: <code>Promise.&lt;Response&gt;</code> - Fetch response  

| Param | Type | Description |
| --- | --- | --- |
| payload | <code>Object</code> | Discord webhook payload |
| [payload.embeds] | <code>Array.&lt;Object&gt;</code> | Array of Discord embeds |

<a name="StarCitizenAPI+announceActivity"></a>

### starCitizenAPI.announceActivity(activity) ⇒ <code>Promise.&lt;Response&gt;</code>
Announce an activity to the configured authority.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: <code>Promise.&lt;Response&gt;</code> - Fetch response  

| Param | Type | Description |
| --- | --- | --- |
| activity | [<code>StarCitizenActivity</code>](#StarCitizenActivity) | Activity to announce |

<a name="StarCitizenAPI+screenshot"></a>

### starCitizenAPI.screenshot() ⇒ <code>Promise.&lt;Buffer&gt;</code>
Take a screenshot of the current display.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: <code>Promise.&lt;Buffer&gt;</code> - Screenshot image buffer  
<a name="StarCitizenAPI+start"></a>

### starCitizenAPI.start() ⇒ [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI)
Start the service.
Begins monitoring the game log and starts HTTP server if configured.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI) - Returns this for chaining  
**Emits**: <code>event:ready When service is fully started</code>, <code>event:error If an error occurs during startup</code>  
<a name="StarCitizenAPI+stop"></a>

### starCitizenAPI.stop() ⇒ [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI)
Stop the service.
Stops monitoring the game log and stops HTTP server if running.

**Kind**: instance method of [<code>StarCitizenAPI</code>](#StarCitizenAPI)  
**Returns**: [<code>Promise.&lt;StarCitizenAPI&gt;</code>](#StarCitizenAPI) - Returns this for chaining  
**Emits**: <code>event:stopped When service is fully stopped</code>  
<a name="Mission"></a>

## Mission ⇐ <code>Entity</code>
Represents a Mission in the Star Citizen universe.
Missions can be accepted by signing with secp256k1 or Musig2 multisig.

**Kind**: global class  
**Extends**: <code>Entity</code>  

* [Mission](#Mission) ⇐ <code>Entity</code>
    * [new Mission(data)](#new_Mission_new)
    * [.meetsRequirements(player)](#Mission+meetsRequirements) ⇒ <code>Boolean</code>
    * [.isExpired()](#Mission+isExpired) ⇒ <code>Boolean</code>
    * [.isOpen()](#Mission+isOpen) ⇒ <code>Boolean</code>
    * [.isMultisig()](#Mission+isMultisig) ⇒ <code>Boolean</code>
    * [.getRequiredSignatures()](#Mission+getRequiredSignatures) ⇒ <code>Number</code>
    * [.hasEnoughSignatures()](#Mission+hasEnoughSignatures) ⇒ <code>Boolean</code>
    * [.generateContractCommitment()](#Mission+generateContractCommitment) ⇒ <code>String</code>
    * [.toJSON()](#Mission+toJSON) ⇒ <code>Object</code>

<a name="new_Mission_new"></a>

### new Mission(data)
Create a Mission instance.


| Param | Type | Description |
| --- | --- | --- |
| data | <code>Object</code> | Mission data. |
| data.id | <code>String</code> | Unique mission identifier. |
| data.title | <code>String</code> | Mission title. |
| data.description | <code>String</code> | Mission description. |
| data.type | <code>String</code> | Mission type (e.g., 'bounty', 'cargo', 'exploration'). |
| data.reward | <code>Number</code> | Reward amount in UEC. |
| data.status | <code>String</code> | Mission status ('open', 'assigned', 'completed', 'failed'). |
| data.requirements | <code>Object</code> | Mission requirements. |
| [data.requirements.minReputation] | <code>Number</code> | Minimum reputation required. |
| [data.requirements.skills] | <code>Array.&lt;String&gt;</code> | Required skills. |
| [data.requirements.vehicleType] | <code>String</code> | Required vehicle type. |
| data.location | <code>Object</code> | Mission location. |
| data.location.system | <code>String</code> | Star system. |
| data.location.planet | <code>String</code> | Planet or station. |
| data.contract | <code>Object</code> | Contract configuration. |
| data.contract.type | <code>String</code> | 'single' or 'multisig'. |
| [data.contract.requiredSignatures] | <code>Number</code> | Required signatures for multisig. |
| [data.contract.authorizedSigners] | <code>Array.&lt;String&gt;</code> | Authorized signer public keys. |
| data.issuer | <code>String</code> | Mission issuer ID. |
| [data.assignee] | <code>String</code> | Current assignee ID. |
| data.expiresAt | <code>Number</code> | Expiration timestamp. |
| data.createdAt | <code>Number</code> | Creation timestamp. |

<a name="Mission+meetsRequirements"></a>

### mission.meetsRequirements(player) ⇒ <code>Boolean</code>
Check if a player meets the mission requirements.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether player meets requirements.  

| Param | Type | Description |
| --- | --- | --- |
| player | <code>Object</code> | Player data. |

<a name="Mission+isExpired"></a>

### mission.isExpired() ⇒ <code>Boolean</code>
Check if the mission is expired.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether mission is expired.  
<a name="Mission+isOpen"></a>

### mission.isOpen() ⇒ <code>Boolean</code>
Check if mission can accept more applications.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether mission is open for applications.  
<a name="Mission+isMultisig"></a>

### mission.isMultisig() ⇒ <code>Boolean</code>
Check if mission requires multisig.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether mission requires multiple signatures.  
<a name="Mission+getRequiredSignatures"></a>

### mission.getRequiredSignatures() ⇒ <code>Number</code>
Get required number of signatures.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Number</code> - Required signature count.  
<a name="Mission+hasEnoughSignatures"></a>

### mission.hasEnoughSignatures() ⇒ <code>Boolean</code>
Check if signature threshold is met.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Boolean</code> - Whether enough signatures have been collected.  
<a name="Mission+generateContractCommitment"></a>

### mission.generateContractCommitment() ⇒ <code>String</code>
Generate a contract commitment for signing.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>String</code> - Hex-encoded contract hash.  
<a name="Mission+toJSON"></a>

### mission.toJSON() ⇒ <code>Object</code>
Convert mission to JSON.

**Kind**: instance method of [<code>Mission</code>](#Mission)  
**Returns**: <code>Object</code> - Mission data.  
<a name="MissionApplication"></a>

## MissionApplication ⇐ <code>Entity</code>
Represents an application to accept a Mission.

**Kind**: global class  
**Extends**: <code>Entity</code>  

* [MissionApplication](#MissionApplication) ⇐ <code>Entity</code>
    * [new MissionApplication(data)](#new_MissionApplication_new)
    * [.isMultisig()](#MissionApplication+isMultisig) ⇒ <code>Boolean</code>
    * [.isApproved()](#MissionApplication+isApproved) ⇒ <code>Boolean</code>
    * [.isPending()](#MissionApplication+isPending) ⇒ <code>Boolean</code>
    * [.approve()](#MissionApplication+approve)
    * [.reject(reason)](#MissionApplication+reject)
    * [.toJSON()](#MissionApplication+toJSON) ⇒ <code>Object</code>

<a name="new_MissionApplication_new"></a>

### new MissionApplication(data)
Create a MissionApplication instance.


| Param | Type | Description |
| --- | --- | --- |
| data | <code>Object</code> | Application data. |
| data.missionId | <code>String</code> | Mission ID being applied to. |
| data.applicantId | <code>String</code> | Applicant's player ID. |
| data.publicKey | <code>String</code> | Applicant's public key (secp256k1). |
| data.signature | <code>String</code> | Application signature. |
| [data.message] | <code>String</code> | Optional message from applicant. |
| data.status | <code>String</code> | Application status ('pending', 'approved', 'rejected'). |
| [data.multisigData] | <code>Object</code> | Musig2 multisig data if applicable. |
| [data.multisigData.participantKeys] | <code>Array.&lt;String&gt;</code> | Participant public keys. |
| [data.multisigData.aggregatedKey] | <code>String</code> | Aggregated public key. |
| [data.multisigData.nonces] | <code>Array.&lt;Object&gt;</code> | Musig2 nonces. |
| data.createdAt | <code>Number</code> | Application timestamp. |

<a name="MissionApplication+isMultisig"></a>

### missionApplication.isMultisig() ⇒ <code>Boolean</code>
Check if application is for multisig.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
**Returns**: <code>Boolean</code> - Whether this is a multisig application.  
<a name="MissionApplication+isApproved"></a>

### missionApplication.isApproved() ⇒ <code>Boolean</code>
Check if application is approved.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
**Returns**: <code>Boolean</code> - Whether application is approved.  
<a name="MissionApplication+isPending"></a>

### missionApplication.isPending() ⇒ <code>Boolean</code>
Check if application is pending.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
**Returns**: <code>Boolean</code> - Whether application is pending.  
<a name="MissionApplication+approve"></a>

### missionApplication.approve()
Approve the application.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
<a name="MissionApplication+reject"></a>

### missionApplication.reject(reason)
Reject the application.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  

| Param | Type | Description |
| --- | --- | --- |
| reason | <code>String</code> | Rejection reason. |

<a name="MissionApplication+toJSON"></a>

### missionApplication.toJSON() ⇒ <code>Object</code>
Convert application to JSON.

**Kind**: instance method of [<code>MissionApplication</code>](#MissionApplication)  
**Returns**: <code>Object</code> - Application data.  
<a name="MissionManager"></a>

## MissionManager
Mission Manager service.
Handles mission lifecycle, applications, and cryptographic verification.
Supports both single secp256k1 signatures and Musig2 multisig.

**Kind**: global class  

* [MissionManager](#MissionManager)
    * [new MissionManager([settings])](#new_MissionManager_new)
    * [.createMission(data)](#MissionManager+createMission) ⇒ [<code>Mission</code>](#Mission)
    * [.getMission(missionId)](#MissionManager+getMission) ⇒ [<code>Mission</code>](#Mission) \| <code>null</code>
    * [.submitApplication(applicationData)](#MissionManager+submitApplication) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.verifySignature(message, signature, publicKey, [multisigData])](#MissionManager+verifySignature) ⇒ <code>Promise.&lt;Boolean&gt;</code>
    * [.verifySecp256k1Signature(message, signature, publicKey)](#MissionManager+verifySecp256k1Signature) ⇒ <code>Boolean</code>
    * [.verifyMusig2Signature(message, signature, multisigData)](#MissionManager+verifyMusig2Signature) ⇒ <code>Promise.&lt;Boolean&gt;</code>
    * [.approveApplication(applicationId)](#MissionManager+approveApplication) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.rejectApplication(applicationId, reason)](#MissionManager+rejectApplication) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.completeMission(missionId, completionData)](#MissionManager+completeMission) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
    * [.failMission(missionId, reason)](#MissionManager+failMission) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
    * [.getMissionApplications(missionId)](#MissionManager+getMissionApplications) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.getApplicantApplications(applicantId)](#MissionManager+getApplicantApplications) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)

<a name="new_MissionManager_new"></a>

### new MissionManager([settings])
Create a MissionManager instance.


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration settings. |

<a name="MissionManager+createMission"></a>

### missionManager.createMission(data) ⇒ [<code>Mission</code>](#Mission)
Create a new mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Mission</code>](#Mission) - Created mission.  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Object</code> | Mission data. |

<a name="MissionManager+getMission"></a>

### missionManager.getMission(missionId) ⇒ [<code>Mission</code>](#Mission) \| <code>null</code>
Get a mission by ID.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Mission</code>](#Mission) \| <code>null</code> - Mission instance or null.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |

<a name="MissionManager+submitApplication"></a>

### missionManager.submitApplication(applicationData) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
Submit an application to accept a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication) - Created application.  

| Param | Type | Description |
| --- | --- | --- |
| applicationData | <code>Object</code> | Application data. |
| applicationData.missionId | <code>String</code> | Mission ID. |
| applicationData.applicantId | <code>String</code> | Applicant ID. |
| applicationData.publicKey | <code>String</code> | Applicant's public key. |
| applicationData.signature | <code>String</code> | Application signature. |
| [applicationData.multisigData] | <code>Object</code> | Musig2 data if applicable. |

<a name="MissionManager+verifySignature"></a>

### missionManager.verifySignature(message, signature, publicKey, [multisigData]) ⇒ <code>Promise.&lt;Boolean&gt;</code>
Verify a signature (single or multisig).

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: <code>Promise.&lt;Boolean&gt;</code> - Verification result.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| message | <code>String</code> |  | Message hash to verify. |
| signature | <code>String</code> |  | Signature to verify. |
| publicKey | <code>String</code> |  | Public key for single sig. |
| [multisigData] | <code>Object</code> | <code></code> | Musig2 data for multisig. |

<a name="MissionManager+verifySecp256k1Signature"></a>

### missionManager.verifySecp256k1Signature(message, signature, publicKey) ⇒ <code>Boolean</code>
Verify a single secp256k1 signature.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: <code>Boolean</code> - Verification result.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>String</code> | Message hash. |
| signature | <code>String</code> | Signature hex. |
| publicKey | <code>String</code> | Public key hex. |

<a name="MissionManager+verifyMusig2Signature"></a>

### missionManager.verifyMusig2Signature(message, signature, multisigData) ⇒ <code>Promise.&lt;Boolean&gt;</code>
Verify a Musig2 multisig signature.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: <code>Promise.&lt;Boolean&gt;</code> - Verification result.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>String</code> | Message hash. |
| signature | <code>String</code> | Aggregated signature. |
| multisigData | <code>Object</code> | Musig2 data. |

<a name="MissionManager+approveApplication"></a>

### missionManager.approveApplication(applicationId) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
Approve an application.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication) - Approved application.  

| Param | Type | Description |
| --- | --- | --- |
| applicationId | <code>String</code> | Application ID. |

<a name="MissionManager+rejectApplication"></a>

### missionManager.rejectApplication(applicationId, reason) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
Reject an application.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication) - Rejected application.  

| Param | Type | Description |
| --- | --- | --- |
| applicationId | <code>String</code> | Application ID. |
| reason | <code>String</code> | Rejection reason. |

<a name="MissionManager+completeMission"></a>

### missionManager.completeMission(missionId, completionData) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
Complete a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;Mission&gt;</code>](#Mission) - Completed mission.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |
| completionData | <code>Object</code> | Completion data. |

<a name="MissionManager+failMission"></a>

### missionManager.failMission(missionId, reason) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
Fail a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;Mission&gt;</code>](#Mission) - Failed mission.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |
| reason | <code>String</code> | Failure reason. |

<a name="MissionManager+getMissionApplications"></a>

### missionManager.getMissionApplications(missionId) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)
Get applications for a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication) - Mission applications.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |

<a name="MissionManager+getApplicantApplications"></a>

### missionManager.getApplicantApplications(applicantId) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)
Get applications by applicant.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication) - Applicant's applications.  

| Param | Type | Description |
| --- | --- | --- |
| applicantId | <code>String</code> | Applicant ID. |

<a name="StarCitizen"></a>

## StarCitizen ⇐ <code>Hub</code>
Core service for Star Citizen.
Provides a Fabric-compatible declarative API with Discord integration.

**Kind**: global class  
**Extends**: <code>Hub</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| activities | <code>Array</code> | Collection of activities from the game log. |
| players | <code>Array</code> | Collection of known players. |
| vehicles | <code>Array</code> | Collection of known vehicles. |
| logs | <code>Array</code> | Collection of log entries. |
| kills | <code>Array</code> | Collection of kill events. |
| discord | <code>Object</code> | Discord integration instance. |


* [StarCitizen](#StarCitizen) ⇐ <code>Hub</code>
    * [new StarCitizen([settings])](#new_StarCitizen_new)
    * [.postToDiscord(payload)](#StarCitizen+postToDiscord) ⇒ <code>Promise.&lt;Response&gt;</code>

<a name="new_StarCitizen_new"></a>

### new StarCitizen([settings])
Create an instance of the Star Citizen service.

**Returns**: [<code>StarCitizen</code>](#StarCitizen) - A new instance of the Star Citizen service.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  | Configuration for this instance. |
| [settings.logfile] | <code>Object</code> | <code>C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log</code> | Path to the log file for Star Citizen. |
| [settings.discord] | <code>Object</code> |  | Discord configuration. |
| [settings.discord.webhook] | <code>String</code> |  | Discord webhook URL for posting updates. |
| [settings.discord.channel] | <code>String</code> |  | Discord channel ID for posting updates. |
| [settings.discord.enable] | <code>Boolean</code> | <code>false</code> | Enable Discord integration. |

<a name="StarCitizen+postToDiscord"></a>

### starCitizen.postToDiscord(payload) ⇒ <code>Promise.&lt;Response&gt;</code>
Post a message to Discord via webhook.

**Kind**: instance method of [<code>StarCitizen</code>](#StarCitizen)  
**Returns**: <code>Promise.&lt;Response&gt;</code> - The fetch response.  

| Param | Type | Description |
| --- | --- | --- |
| payload | <code>Object</code> | The Discord webhook payload. |

<a name="StarCitizenActivity"></a>

## StarCitizenActivity : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the activity |
| type | <code>String</code> | Type of activity (e.g., 'StarCitizenLogEntry', 'MissionComplete') |
| actor | <code>Object</code> | The actor performing the activity |
| actor.id | <code>String</code> | Actor ID |
| [actor.name] | <code>String</code> | Actor name |
| object | <code>Object</code> | The object of the activity |
| object.id | <code>String</code> | Object ID |
| [object.content] | <code>String</code> | Object content |
| target | <code>String</code> | Target path of the activity |
| timestamp | <code>String</code> | ISO timestamp of the activity |

<a name="StarCitizenPlayer"></a>

## StarCitizenPlayer : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the player |
| name | <code>String</code> | Player name |
| timestamp | <code>String</code> | ISO timestamp when player was registered |
| [metadata] | <code>Object</code> | Additional player metadata |

<a name="StarCitizenVehicle"></a>

## StarCitizenVehicle : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the vehicle |
| name | <code>String</code> | Vehicle name |
| [type] | <code>String</code> | Vehicle type (e.g., 'fighter', 'transport') |
| [owner] | <code>String</code> | Owner player ID |
| timestamp | <code>String</code> | ISO timestamp when vehicle was registered |

<a name="StarCitizenKill"></a>

## StarCitizenKill : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the kill event |
| killer | <code>String</code> | Name or ID of the killer |
| victim | <code>String</code> | Name or ID of the victim |
| [weapon] | <code>String</code> | Weapon used for the kill |
| timestamp | <code>String</code> | ISO timestamp of the kill event |

<a name="StarCitizenLogEntry"></a>

## StarCitizenLogEntry : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| id | <code>String</code> | Unique identifier for the log entry |
| timestamp | <code>String</code> | Timestamp from the log file |
| parts | <code>Array.&lt;String&gt;</code> | Parsed parts of the log entry |
| [content] | <code>String</code> | Raw log content |

<a name="DiscordConfig"></a>

## DiscordConfig : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| enable | <code>Boolean</code> | Whether Discord integration is enabled |
| [webhook] | <code>String</code> | Discord webhook URL |
| [channel] | <code>String</code> | Discord channel ID |
| announceActivities | <code>Boolean</code> | Whether to announce activities to Discord |
| announceKills | <code>Boolean</code> | Whether to announce kills to Discord |
| announcePlayerJoins | <code>Boolean</code> | Whether to announce player joins to Discord |

<a name="StarCitizenSettings"></a>

## StarCitizenSettings : <code>Object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| [name] | <code>String</code> | Service name |
| [authority] | <code>String</code> | Authority URL for announcements |
| [logfile] | <code>String</code> | Path to Star Citizen game log file |
| [http] | <code>Object</code> | HTTP server configuration |
| [http.enable] | <code>Boolean</code> | Whether to enable HTTP server |
| [http.port] | <code>Number</code> | HTTP server port |
| [discord] | [<code>DiscordConfig</code>](#DiscordConfig) | Discord integration configuration |

