## Classes

<dl>
<dt><a href="#Group">Group</a></dt>
<dd></dd>
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

## Constants

<dl>
<dt><a href="#crypto">crypto</a></dt>
<dd><p>Group — a member-created org unit backed by a k-of-n Schnorr multisig.</p>
<p>Members are identified by their compressed secp256k1 public keys (the same
actor ids the identity onboarding produces). Threshold decisions (mission
acceptance, payout release) are verified with the standard Fabric
<a href="Federation">Federation</a> k-of-n Schnorr verification (BIP340).</p>
</dd>
<dt><a href="#crypto">crypto</a></dt>
<dd><p>GroupManager — member-created groups with k-of-n Schnorr multisig.</p>
<p>Any player (pubkey) may create a group; members may add members. Groups
scope mission visibility (missions shared to a group are served only to
its members) and act as authority sets for mission acceptance/payouts.
Mutations are recorded in a hash-chained audit log (same pattern as
MissionManager).</p>
</dd>
<dt><a href="#http">http</a></dt>
<dd><p>Star Citizen Live - Fabric-free service (M1 skeleton + M3 parser).</p>
<p>Boots with ZERO external dependencies - only Node.js built-ins (http, crypto,
events, fs, readline) plus global fetch. No @fabric/hub, no SSH git deps, no
400 MB install. <code>node services/LiveRelay.js</code> just works.</p>
<p>Features: in-memory collections, REST endpoints, live log tailing (read-only,
optional) AND offline replay, real Game.log event parsing (functions/parser.js),
optional Discord webhook posting, and the mission/contract seam.</p>
<p>It edits NOTHING in the Star Citizen installation - the log is only ever read.</p>
</dd>
<dt><a href="#crypto">crypto</a></dt>
<dd><p>MissionManager — the org mission register (M5.1).</p>
<p>Implements D-005: a centralized, OFFICER-VALIDATED register. Lifecycle:
  open --apply--&gt; (applications) --officer accept--&gt; assigned
       --claim(assignee)--&gt; (claim) --officer validate(approve)--&gt; completed
                                      --officer validate(reject)--&gt; back to assigned
  open|assigned --officer cancel--&gt; cancelled</p>
<p>Every mutation appends a hash-chained AuditEntry (tamper-evident; M6 adds
officer signatures over each entry). Backed by stores/register.js (memory or file).
Keeps the method names/events the rest of the code already uses
(createMission/getMission/missions, start/stop) so nothing else breaks.</p>
<p>Officer model: settings.officers is an allowlist of actor ids. If EMPTY, the
register runs in permissive &quot;bootstrap&quot; mode (everyone is an officer) so it is
usable before roles are wired (REST/Discord auth lands in M5.2/M5.3).</p>
</dd>
<dt><a href="#EventEmitter">EventEmitter</a></dt>
<dd><p>PayoutManager — Bitcoin-unlocked mission rewards.</p>
<p>A mission&#39;s reward can be escrowed on-chain in a k-of-n multisig address
built from the mission&#39;s AUTHORITY pubkeys (the same keys whose Schnorr
signatures accept the completion claim). Flow:</p>
<ol>
<li>createEscrow(mission)   -&gt; k-of-n P2WSH address (bitcoind createmultisig)</li>
<li>(creator funds address) -&gt; checkFunding() confirms via scantxoutset</li>
<li>claim accepted (k-of-n Schnorr on the acceptance message, MissionManager)
-&gt; &#39;payout:unlocked&#39; -&gt; escrow status &#39;payable&#39;</li>
<li>buildPayout()           -&gt; PSBT paying the claimant (authorities sign
                       with their own wallets — keys never touch
                       the server)</li>
<li>broadcastPayout(hex)    -&gt; sendrawtransaction</li>
</ol>
<p>Modes:</p>
<ul>
<li>LEDGER (no rpc): the obligation + authorization are recorded and
auditable; settlement happens out-of-band.</li>
<li>BITCOIN (rpc provided): full on-chain flow. Mainnet is refused unless
<code>allowMainnet: true</code> — regtest/signet first, by decision.</li>
</ul>
<p><code>rpc</code> is any <code>(method, params) =&gt; Promise&lt;result&gt;</code> — on goon.vc it wraps
the Hub&#39;s managed bitcoind (<code>@fabric/core</code> Bitcoin <code>_makeRPCRequest</code>).</p>
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
<a name="Group"></a>

## Group
**Kind**: global class  

* [Group](#Group)
    * [new Group(data)](#new_Group_new)
    * [.includes()](#Group+includes) ⇒ <code>Boolean</code>
    * [.validate()](#Group+validate)
    * [.commitment()](#Group+commitment)
    * [.federation()](#Group+federation)
    * [.verifyMultiSignature(multiSig, [threshold])](#Group+verifyMultiSignature) ⇒ <code>Boolean</code>

<a name="new_Group_new"></a>

### new Group(data)

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| data | <code>Object</code> |  | Group data. |
| data.id | <code>String</code> |  | Group id. |
| data.name | <code>String</code> |  | Display name. |
| data.creator | <code>String</code> |  | Creator pubkey (hex). |
| data.members | <code>Array.&lt;String&gt;</code> |  | Member pubkeys (hex). |
| [data.threshold] | <code>Number</code> | <code>1</code> | Signatures required for group decisions. |
| [data.createdAt] | <code>String</code> |  | ISO timestamp. |

<a name="Group+includes"></a>

### group.includes() ⇒ <code>Boolean</code>
**Kind**: instance method of [<code>Group</code>](#Group)  
**Returns**: <code>Boolean</code> - True when `pubkey` is a member of this group.  
<a name="Group+validate"></a>

### group.validate()
Validate shape: pubkeys well-formed, threshold achievable.

**Kind**: instance method of [<code>Group</code>](#Group)  
<a name="Group+commitment"></a>

### group.commitment()
Deterministic commitment over the group's identity-defining fields.

**Kind**: instance method of [<code>Group</code>](#Group)  
<a name="Group+federation"></a>

### group.federation()
Lazily build the Fabric Federation for this member set.

**Kind**: instance method of [<code>Group</code>](#Group)  
<a name="Group+verifyMultiSignature"></a>

### group.verifyMultiSignature(multiSig, [threshold]) ⇒ <code>Boolean</code>
Verify a k-of-n multisignature against this group's roster + threshold.
Signers sign the raw message bytes with BIP340 Schnorr (Fabric
`Key.signSchnorr`); non-member signatures do not count.

**Kind**: instance method of [<code>Group</code>](#Group)  
**Returns**: <code>Boolean</code> - True when at least `threshold` member signatures verify.  

| Param | Type | Description |
| --- | --- | --- |
| multiSig | <code>Object</code> | `{ message, signatures: { [pubkey]: sigHexOrBuffer } }`. |
| [threshold] | <code>Number</code> | Override (defaults to the group threshold). |

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
| data.applicantId | <code>String</code> | Combined public key (hex). Single secp256k1   or Musig2-aggregated key — same opaque format as any other public key in the   system; not a separate player/handle identity. |
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
    * [._normalizeAuthorities()](#MissionManager+_normalizeAuthorities)
    * [.getMission(missionId)](#MissionManager+getMission) ⇒ [<code>Mission</code>](#Mission) \| <code>null</code>
    * [.getMissionApplications(missionId)](#MissionManager+getMissionApplications) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.acceptanceMessage(mission, claim)](#MissionManager+acceptanceMessage) ⇒ <code>String</code>
    * [.verifyAcceptance()](#MissionManager+verifyAcceptance) ⇒ <code>Boolean</code>
    * [.submitApplication(applicationData)](#MissionManager+submitApplication) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.verifySignature(message, signature, publicKey, [multisigData])](#MissionManager+verifySignature) ⇒ <code>Promise.&lt;Boolean&gt;</code>
    * [.verifySecp256k1Signature(message, signature, publicKey)](#MissionManager+verifySecp256k1Signature) ⇒ <code>Boolean</code>
    * [.verifyMusig2Signature(message, signature, multisigData)](#MissionManager+verifyMusig2Signature) ⇒ <code>Promise.&lt;Boolean&gt;</code>
    * [.approveApplication(applicationId)](#MissionManager+approveApplication) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.rejectApplication(applicationId, reason)](#MissionManager+rejectApplication) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
    * [.completeMission(missionId, completionData)](#MissionManager+completeMission) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
    * [.failMission(missionId, reason)](#MissionManager+failMission) ⇒ [<code>Promise.&lt;Mission&gt;</code>](#Mission)
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

<a name="MissionManager+_normalizeAuthorities"></a>

### missionManager.\_normalizeAuthorities()
Normalize the authorities field: `{ keys: [pubkey…], threshold }` or null.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+getMission"></a>

### missionManager.getMission(missionId) ⇒ [<code>Mission</code>](#Mission) \| <code>null</code>
Get a mission by ID.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Mission</code>](#Mission) \| <code>null</code> - Mission instance or null.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |

<a name="MissionManager+getMissionApplications"></a>

### missionManager.getMissionApplications(missionId) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)
Get applications for a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication) - Mission applications.  

| Param | Type | Description |
| --- | --- | --- |
| missionId | <code>String</code> | Mission ID. |

<a name="MissionManager+acceptanceMessage"></a>

### missionManager.acceptanceMessage(mission, claim) ⇒ <code>String</code>
Deterministic message the mission's authorities must sign to accept a
completion claim (and release any escrowed payout).

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: <code>String</code> - Canonical acceptance message.  

| Param | Type | Description |
| --- | --- | --- |
| mission | <code>Object</code> | Mission record. |
| claim | <code>Object</code> | Claim record. |

<a name="MissionManager+verifyAcceptance"></a>

### missionManager.verifyAcceptance() ⇒ <code>Boolean</code>
Verify a k-of-n acceptance against the mission's authorities set.
Signers sign `acceptanceMessage(mission, claim)` bytes with BIP340
Schnorr; only authority pubkeys count.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
<a name="MissionManager+submitApplication"></a>

### missionManager.submitApplication(applicationData) ⇒ [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication)
Submit an application to accept a mission.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Promise.&lt;MissionApplication&gt;</code>](#MissionApplication) - Created application.  

| Param | Type | Description |
| --- | --- | --- |
| applicationData | <code>Object</code> | Application data. |
| applicationData.missionId | <code>String</code> | Mission ID. |
| applicationData.applicantId | <code>String</code> | Combined public key (hex). |
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

<a name="MissionManager+getApplicantApplications"></a>

### missionManager.getApplicantApplications(applicantId) ⇒ [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication)
Get applications by applicant.

**Kind**: instance method of [<code>MissionManager</code>](#MissionManager)  
**Returns**: [<code>Array.&lt;MissionApplication&gt;</code>](#MissionApplication) - Applicant's applications.  

| Param | Type | Description |
| --- | --- | --- |
| applicantId | <code>String</code> | Combined public key (hex). |

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
    * [.getUIConfig()](#StarCitizen+getUIConfig) ⇒ <code>Object</code> \| <code>null</code>

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

<a name="StarCitizen+getUIConfig"></a>

### starCitizen.getUIConfig() ⇒ <code>Object</code> \| <code>null</code>
Get UI component configuration for Sensemaker integration.
Services can override this method to declare their UI components.

**Kind**: instance method of [<code>StarCitizen</code>](#StarCitizen)  
**Returns**: <code>Object</code> \| <code>null</code> - UI component configuration or null  
<a name="crypto"></a>

## crypto
Group — a member-created org unit backed by a k-of-n Schnorr multisig.

Members are identified by their compressed secp256k1 public keys (the same
actor ids the identity onboarding produces). Threshold decisions (mission
acceptance, payout release) are verified with the standard Fabric
[Federation](Federation) k-of-n Schnorr verification (BIP340).

**Kind**: global constant  
<a name="crypto"></a>

## crypto
GroupManager — member-created groups with k-of-n Schnorr multisig.

Any player (pubkey) may create a group; members may add members. Groups
scope mission visibility (missions shared to a group are served only to
its members) and act as authority sets for mission acceptance/payouts.
Mutations are recorded in a hash-chained audit log (same pattern as
MissionManager).

**Kind**: global constant  
<a name="http"></a>

## http
Star Citizen Live - Fabric-free service (M1 skeleton + M3 parser).

Boots with ZERO external dependencies - only Node.js built-ins (http, crypto,
events, fs, readline) plus global fetch. No @fabric/hub, no SSH git deps, no
400 MB install. `node services/LiveRelay.js` just works.

Features: in-memory collections, REST endpoints, live log tailing (read-only,
optional) AND offline replay, real Game.log event parsing (functions/parser.js),
optional Discord webhook posting, and the mission/contract seam.

It edits NOTHING in the Star Citizen installation - the log is only ever read.

**Kind**: global constant  
<a name="crypto"></a>

## crypto
MissionManager — the org mission register (M5.1).

Implements D-005: a centralized, OFFICER-VALIDATED register. Lifecycle:
  open --apply--> (applications) --officer accept--> assigned
       --claim(assignee)--> (claim) --officer validate(approve)--> completed
                                      --officer validate(reject)--> back to assigned
  open|assigned --officer cancel--> cancelled

Every mutation appends a hash-chained AuditEntry (tamper-evident; M6 adds
officer signatures over each entry). Backed by stores/register.js (memory or file).
Keeps the method names/events the rest of the code already uses
(createMission/getMission/missions, start/stop) so nothing else breaks.

Officer model: settings.officers is an allowlist of actor ids. If EMPTY, the
register runs in permissive "bootstrap" mode (everyone is an officer) so it is
usable before roles are wired (REST/Discord auth lands in M5.2/M5.3).

**Kind**: global constant  
<a name="EventEmitter"></a>

## EventEmitter
PayoutManager — Bitcoin-unlocked mission rewards.

A mission's reward can be escrowed on-chain in a k-of-n multisig address
built from the mission's AUTHORITY pubkeys (the same keys whose Schnorr
signatures accept the completion claim). Flow:

  1. createEscrow(mission)   -> k-of-n P2WSH address (bitcoind createmultisig)
  2. (creator funds address) -> checkFunding() confirms via scantxoutset
  3. claim accepted (k-of-n Schnorr on the acceptance message, MissionManager)
     -> 'payout:unlocked' -> escrow status 'payable'
  4. buildPayout()           -> PSBT paying the claimant (authorities sign
                                with their own wallets — keys never touch
                                the server)
  5. broadcastPayout(hex)    -> sendrawtransaction

Modes:
  - LEDGER (no rpc): the obligation + authorization are recorded and
    auditable; settlement happens out-of-band.
  - BITCOIN (rpc provided): full on-chain flow. Mainnet is refused unless
    `allowMainnet: true` — regtest/signet first, by decision.

`rpc` is any `(method, params) => Promise<result>` — on goon.vc it wraps
the Hub's managed bitcoind (`@fabric/core` Bitcoin `_makeRPCRequest`).

**Kind**: global constant  
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

