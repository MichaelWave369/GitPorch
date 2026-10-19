// PhiBots Clubhouse: static fictional sample crew. Zero backend requests.
const crew = [
 {id:'demo-lantern',name:'Lantern',role:'builder',tag:'Draws the plans'},
 {id:'demo-floorboard',name:'Floorboard',role:'tester',tag:'Checks the beams'},
 {id:'demo-gatekeeper',name:'Gatekeeper',role:'reviewer',tag:'Minds the screen door'},
];
const proposed = [
 {id:'DEMO-101',by:'demo-lantern',repo:'porch-demo',summary:'Add a welcoming front porch',state:'AWAITING OPERATOR REVIEW'},
 {id:'DEMO-102',by:'demo-floorboard',repo:'barnyard-lab',summary:'Suggest extra fixture checks',state:'PROPOSED, NOT TESTED'},
 {id:'DEMO-103',by:'demo-gatekeeper',repo:'lantern-ledger',summary:'Review sample permission boundaries',state:'DEMO REVIEW NOTE RECORDED'}
];
const roster = document.getElementById('phibot-roster');
const proposals = document.getElementById('phibot-proposals');
let selected='all', focus=null;
const tag=(name,cls,text)=>{
 const e=document.createElement(name);if(cls)e.className=cls;e.textContent=String(text);return e;
};
function renderClubhouse(){
 roster.replaceChildren();proposals.replaceChildren();
 const members=crew.filter(m=>selected==='all'||m.role===selected);
 for(const member of members){
  const button=tag('button','club-person','');button.type='button';
  button.classList.toggle('selected',focus===member.id);
  button.setAttribute('aria-pressed',focus===member.id?'true':'false');
  const icon=tag('span','chair',member.name[0]);
  const details=tag('span','', '');
  details.append(tag('strong','',member.name+' · DEMO'),tag('small','',member.role.toUpperCase()+' · '+member.tag));
  button.append(icon,details);
  button.addEventListener('click',()=>{focus=focus===member.id?null:member.id;renderClubhouse()});
  roster.append(button);
 }
 const all=proposed.filter(p=>(!focus||p.by===focus)&&members.some(m=>m.id===p.by));
 if(!all.length)proposals.append(tag('p','club-note','No fictional proposals match this filter.'));
 for(const item of all){
  const card=tag('div','club-proposal','');
  const author=crew.find(m=>m.id===item.by);
  card.append(tag('strong','',item.summary),tag('small','',item.id+' · '+author.name+' · '+item.repo),tag('span','state',item.state+' · FICTIONAL'));
  proposals.append(card);
 }
}
for(const button of document.querySelectorAll('.crew-filter button')){
 button.addEventListener('click',()=>{
  selected=button.dataset.role;focus=null;
  document.querySelectorAll('.crew-filter button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  renderClubhouse();
 });
}
renderClubhouse();
