const $ = (id) => document.getElementById(id);
const samples = [
 {name:'porch-demo',branches:['main'],latest:{hash:'b39f4a8',subject:'feat: plant the first porch posts',date:'2026-10-19T12:00:00Z'}},
 {name:'lantern-ledger',branches:['main','dev'],latest:{hash:'a7d9e31',subject:'docs: file the lantern ledger',date:'2026-10-19T12:00:00Z'}},
 {name:'barnyard-lab',branches:['main'],latest:{hash:'f90c2de',subject:'test: inspect the floorboards',date:'2026-10-19T12:00:00Z'}}
];
let showcase = false;
function node(tag, klass='', value) {
 const e = document.createElement(tag);if(klass)e.className=klass;if(value!==undefined)e.textContent=String(value);return e;
}
function date(value) {
 if(!value)return 'No commits yet';const d=new Date(value);
 return Number.isNaN(d.getTime())?'Unknown date':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
async function inspect(repo, button) {
 document.querySelectorAll('.repo').forEach(b=>b.classList.remove('active'));button.classList.add('active');
 const history=$('history');history.replaceChildren(node('strong','',repo.name));
 let commits=[];
 if(showcase){if(repo.latest)commits=[{...repo.latest,author:'Fictional example'}];}
 else try {
   const result=await fetch('/api/repos/'+encodeURIComponent(repo.name)+'/commits',{cache:'no-store'});
   if(!result.ok)throw new Error();commits=(await result.json()).commits || [];
 }catch {history.append(node('p','','Unable to read local Git history.'));return}
 if(!commits.length){history.append(node('p','','No commits yet. Push a commit and check again.'));return}
 for(const c of commits.slice(0,8)) {
   const item=node('div','commit');item.append(node('b','',c.subject||'(no message)'),node('small','',c.hash+' · '+date(c.date)+(c.author?' · '+c.author:'')));history.append(item);
 }
}
function render(repos) {
 $('repo-count').textContent=repos.length;
 $('branch-count').textContent=repos.reduce((n,r)=>n+r.branches.length,0);
 const list=$('repos');list.replaceChildren();
 if(!repos.length){list.append(node('div','empty','No repositories yet. Create one with: node src/cli.mjs init hello-world'));return;}
 for(const repo of repos) {
   const b=node('button','repo');b.type='button';b.setAttribute('aria-label','Inspect '+repo.name);
   const info=node('div','repo-info');
   info.append(node('strong','',repo.name),node('p','',repo.latest?.subject||'Waiting for the first commit'),node('small','',repo.branches.length+' branches · '+date(repo.latest?.date)));
   b.append(node('span','repo-icon','⑂'),info,node('span','repo-tag',showcase?'DEMO':'LOCAL'));
   b.addEventListener('click',()=>inspect(repo,b));list.append(b);
 }
 list.firstElementChild?.click();
}
async function load() {
 try {
   const [s,r]=await Promise.all([fetch('/api/status',{cache:'no-store'}),fetch('/api/repos',{cache:'no-store'})]);
   if(!s.ok||!r.ok)throw new Error();
   const status=await s.json(), payload=await r.json();
   if(status.service!=='The GitPorch'||!Array.isArray(payload.repositories))throw new Error();
   $('status').textContent='●  LOCAL / CONNECTED';
   $('transport').textContent=status.gitTransport==='starting_or_available'?'LOCAL ONLY':'CHECK STATUS';
   $('notice').textContent='LOCAL SERVICE CONNECTED · Real repositories from your machine. Network clones are read-only. Push over a local filesystem remote.';
   render(payload.repositories);
 }catch {
   showcase=true;$('status').textContent='●  SHOWCASE / OFFLINE';$('transport').textContent='DEMO';
   $('notice').classList.add('demo');$('notice').textContent='SHOWCASE MODE · Fictional sample repositories only. Run npm start locally to view actual Git data.';
   render(samples);
 }
}
for(const b of document.querySelectorAll('button[data-copy]'))b.addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied!'}catch{b.textContent='Select the code above'}
});
load();

async function refreshClubhouse(){
 const members=document.getElementById('club-members');
 const proposals=document.getElementById('club-proposals');
 if(!members||!proposals)return;
 const safe=(name,klass,text)=>{const e=document.createElement(name);if(klass)e.className=klass;e.textContent=String(text);return e};
 try{
  const response=await fetch('/api/clubhouse',{cache:'no-store'});
  if(!response.ok)throw Error('Crew data unavailable');
  const crew=await response.json();
  members.replaceChildren();proposals.replaceChildren();
  if(!crew.members.length)members.append(safe('p','club-empty','No members registered. The rocking chairs are waiting.'));
  else for(const m of crew.members){
   const card=safe('div','club-row','');
   card.append(safe('strong','',m.displayName),safe('small','',m.id+' · '+m.role.toUpperCase()));
   members.append(card);
  }
  if(!crew.proposals.length)proposals.append(safe('p','club-empty','No proposals yet. Nobody has claimed a green build.'));
  else for(const p of crew.proposals.slice(-12).reverse()){
   const card=safe('div','club-row','');
   card.append(safe('strong','',p.summary),safe('small','',p.memberId+' → '+p.repoName+' @ '+p.commit.slice(0,9)),safe('small','',p.decision+' · NOT A CI RESULT'));
   proposals.append(card);
  }
 }catch(e){
  members.replaceChildren(safe('p','club-empty','Local crew records could not be verified.'));
  proposals.replaceChildren(safe('p','club-empty','Records are withheld when their integrity cannot be checked.'));
 }
}
refreshClubhouse();

async function refreshWorkshop(){
 const counts=document.getElementById('workshop-counts');
 const jobs=document.getElementById('workshop-jobs');
 if(!counts||!jobs)return;
 const mk=(tag,text,cls='')=>{const element=document.createElement(tag);element.textContent=String(text);if(cls)element.className=cls;return element};
 try{
  const response=await fetch('/api/porch-crew',{cache:'no-store'});
  if(!response.ok)throw Error('Queue endpoint unavailable');
  const snapshot=await response.json();
  counts.replaceChildren(mk('p','Queued: '+snapshot.counts.queued+' · Uncertain: '+snapshot.counts.runningUncertain+' · Finished: '+snapshot.counts.done));
  jobs.replaceChildren();
  const latest=snapshot.jobs.slice(0,10);
  if(!latest.length){jobs.append(mk('p','No integrity checks queued yet.','club-empty'));return;}
  for(const job of latest){
   const row=mk('div','','club-row');
   const label=job.status==='DONE'?(job.outcome==='PASS'?'Git fsck PASS · NOT CI':'Git fsck '+job.outcome+' · NOT CI'):
     job.status==='RUNNING_UNCERTAIN'?'INTERRUPTED OR RUNNING · UNVERIFIED':'QUEUED · UNVERIFIED';
   row.append(mk('strong',job.repo+' · '+label),mk('small',job.commit.slice(0,12)+' · '+job.check));
   jobs.append(row);
  }
 }catch{
  counts.replaceChildren(mk('p','Queue unavailable or receipts could not be verified.','club-empty'));
  jobs.replaceChildren(mk('p','No verified queue results can be shown.','club-empty'));
 }
}
refreshWorkshop();
