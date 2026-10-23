const corporateServices={money:'Recibir dinero',combo:'Recibir combo',packages:'Recibir paquetes',topup:'Recarga móvil'};
let corporateService=null,corporateConfirmed=null;
function corporateSelection(){return corporateService;}
function corporateConnected(phone,pairedNow){
  document.getElementById('access-panel').hidden=false;
  if(!pairedNow||corporateConfirmed===phone)return;
  corporateConfirmed=phone;
  document.getElementById('corporate-success').showModal();
}
for(const button of document.querySelectorAll('[data-service]'))button.addEventListener('click',()=>{
  corporateService=button.dataset.service;
  document.getElementById('selected-service-name').textContent=corporateServices[corporateService];
  document.getElementById('service-dialog').showModal();
});
document.getElementById('service-close').onclick=()=>document.getElementById('service-dialog').close();
document.getElementById('service-continue').onclick=()=>{
  document.getElementById('service-dialog').close();
  document.getElementById('access-panel').hidden=false;
  document.getElementById('begin').click();
  document.getElementById('access-panel').scrollIntoView({behavior:'smooth',block:'start'});
};
document.getElementById('corporate-success-close').onclick=()=>document.getElementById('corporate-success').close();
for(const id of ['service-dialog','corporate-success'])document.getElementById(id).addEventListener('click',event=>{if(event.target===document.getElementById(id))event.target.close();});
for(const id of ['another-account','disconnect'])document.getElementById(id).addEventListener('click',()=>{corporateConfirmed=null;});
