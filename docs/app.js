// GitHub Pages showcase: synthetic fixture data only.
// Absolutely no access to localhost, no API calls, no repository uploads.
// Live GitPorch software runs independently on the user's PC.
const samples = [
  {name:'porch-demo',branches:['main','campfire'],commits:[
    {hash:'demo001',subject:'feat: plant the first porch posts',date:'2026-10-17T12:00:00Z',author:'Sample Maintainer'},
    {hash:'demo002',subject:'docs: hang the porch sign',date:'2026-10-16T12:00:00Z',author:'Sample Maintainer'}]},
  {name:'lantern-ledger',branches:['main','review'],commits:[
    {hash:'demo003',subject:'docs: file the lantern ledger',date:'2026-10-16T12:00:00Z',author:'Fictional Reviewer'},
    {hash:'demo004',subject:'test: verify sample receipts',date:'2026-10-15T12:00:00Z',author:'Fictional Reviewer'}]},
  {name:'barnyard-lab',branches:['main'],commits:[
    {hash:'demo005',subject:'test: inspect the floorboards',date:'2026-10-14T12:00:00Z',author:'Sample Tester'},
    {hash:'demo006',subject:'feat: give the barn a door',date:'2026-10-13T12:00:00Z',author:'Sample Tester'}]},
  {name:'blue-ridge-tools',branches:['main','prototype'],commits:[
    {hash:'demo007',subject:'feat: sample branch comparison',date:'2026-10-12T12:00:00Z',author:'Fictional Collaborator'}]}
];
const $ = id => document.getElementById(id);
const elt=(tag,klass='',value)=>{
 const element=document.createElement(tag);
 if(klass)element.className=klass;
 if(value!==undefined)element.textContent=String(value);
 return element;
};
const formatDate=value=>{
 const d=new Date(value);
 return Number.isNaN(d.getTime())?'Unknown':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
};
function inspect(repo,button){
 document.querySelectorAll('button.repo').forEach(x=>x.classList.remove('active'));
 button.classList.add('active');
 const h=$('history');h.replaceChildren(elt('strong','',repo.name+' · FICTIONAL EXAMPLE'));
 for(const commit of repo.commits){
  const row=elt('div','commit');
  row.append(elt('b','',commit.subject),elt('small','',commit.hash+' [DEMO] · '+formatDate(commit.date)+' · '+commit.author));
  h.append(row);
 }
}
function render(){
 const filter=$('repo-filter').value.trim().toLowerCase();
 const list=$('repos');list.replaceChildren();
 const matched=samples.filter(r=>r.name.toLowerCase().includes(filter));
 $('repo-count').textContent=samples.length;
 $('branch-count').textContent=samples.reduce((sum,r)=>sum+r.branches.length,0);
 if(!matched.length){
  list.append(elt('div','empty','No demo repositories match this search.'));
  $('history').replaceChildren(elt('span','','Try a different fictional project name.'));
  return;
 }
 for(const repo of matched){
  const button=elt('button','repo');
  button.type='button';
  button.setAttribute('aria-label','Inspect fictional example '+repo.name);
  const info=elt('div','repo-info');
  info.append(elt('strong','',repo.name),elt('p','',repo.commits[0].subject),elt('small','',repo.branches.length+' branches · '+formatDate(repo.commits[0].date)));
  button.append(elt('span','repo-icon','⑂'),info,elt('span','repo-tag','DEMO'));
  button.addEventListener('click',()=>inspect(repo,button));
  list.append(button);
 }
 list.firstElementChild.click();
}
$('repo-filter').addEventListener('input',render);
for(const button of document.querySelectorAll('button[data-copy]')){
 button.addEventListener('click',async()=>{
   const original='Copy command';
   try{
     await navigator.clipboard.writeText(button.dataset.copy);
     button.textContent='Copied!';
   }catch{button.textContent='Select the code above to copy';}
   setTimeout(()=>{button.textContent=original},2300);
 });
}
render();
