// PhiRunners R1-E: one fail-closed, read-only view over existing Porch Crew lanes.
// This is local queue telemetry, NOT an authenticated GitHub Actions runner.
import {queueSnapshot} from './porch-crew.mjs';
import {snapshot as testSnapshot} from './sandbox-ci.mjs';
import {doctor} from './recovery.mjs';

const VALID='CHECKSUMS_AND_STRUCTURES_ACCEPTED_NOT_SIGNED';
const LANES=[
  ['git','GIT_OBJECT_INTEGRITY',queueSnapshot],
  ['tests','NODE_BUILTIN_TESTS',testSnapshot],
];
const sameCounts=(a,b)=>a.queued===b.queued&&a.runningUncertain===b.runningUncertain&&a.done===b.done;
const totals=()=>({queued:0,runningUncertain:0,done:0,passed:0,failed:0,other:0});
function conciseJob(job,lane){
  return {id:job.id,lane,repo:job.repo,commit:job.commit,queuedAt:job.queuedAt,
    status:job.status,outcome:job.status==='DONE'?job.outcome:null};
}
export async function phirunnersSnapshot(dataDir){
  const checked=await doctor(dataDir);
  const lanes={},jobs=[],sum=totals();
  let consistent=true;
  for(const [name,jobType,read] of LANES){
    const diagnostic=checked.lanes[name];
    const base={jobType,workerLock:diagnostic.workerLock,
      health:'UNVERIFIED',counts:null,outcomes:null,reason:null};
    if(diagnostic.integrity!==VALID){
      base.reason=diagnostic.integrity;
      consistent=false;lanes[name]=base;continue;
    }
    try{
      const snap=await read(dataDir);
      if(!sameCounts(snap.counts,{queued:diagnostic.queued,runningUncertain:diagnostic.runningUncertain,done:diagnostic.completed})){
        base.reason='SNAPSHOT_CHANGED_DURING_READ';
        consistent=false;lanes[name]=base;continue;
      }
      const outcomes={passed:0,failed:0,other:0};
      for(const job of snap.jobs){
        if(job.status!=='DONE')continue;
        if(job.outcome==='PASS')outcomes.passed++;
        else if(job.outcome==='FAIL')outcomes.failed++;
        else outcomes.other++; // ERROR, STALE, NO_TESTS, ABORTED_UNVERIFIED
      }
      base.health='LOCAL_RECEIPTS_CHECKED_NOT_ATTESTED';
      base.counts=snap.counts;
      base.outcomes=outcomes;
      lanes[name]=base;
      jobs.push(...snap.jobs.map(job=>conciseJob(job,name)));
      for(const key of ['queued','runningUncertain','done'])sum[key]+=snap.counts[key];
      for(const [key,value] of Object.entries(outcomes))sum[key]+=value;
    }catch{
      base.reason='RECEIPTS_UNAVAILABLE_OR_CHANGED';
      consistent=false;lanes[name]=base;
    }
  }
  jobs.sort((a,b)=>b.id.localeCompare(a.id));
  return {service:'PhiRunners',version:'R1-E',mode:'LOCAL_READ_ONLY',
    health:consistent?'LOCAL_RECEIPTS_CHECKED_NOT_ATTESTED':'PARTIAL_OR_UNVERIFIED',
    assurance:'NO_REMOTE_RUNNERS_NO_GITHUB_SYNC_NO_SIGNED_EXECUTION_ATTESTATION',
    note:'Worker locks do not prove a worker is alive. Jobs marked RUNNING_UNCERTAIN are not passing.',
    totals:consistent?sum:null,lanes,jobs:jobs.slice(0,20)};
}
