const state = { token: sessionStorage.getItem("attestpay.operatorToken") || "", workflows: [], selected: null };
const queue = document.querySelector("#queueList");
const inspector = document.querySelector("#inspector");
const dialog = document.querySelector("#connectDialog");
document.querySelector("#connectButton").addEventListener("click", () => dialog.showModal());
document.querySelector("#saveToken").addEventListener("click", () => {
  const token = document.querySelector("#tokenInput").value;
  if (token.length >= 20) { state.token = token; sessionStorage.setItem("attestpay.operatorToken", token); queueMicrotask(load); }
});

async function api(path, options = {}) {
  if (!state.token) { dialog.showModal(); throw new Error("Connect with an operator token."); }
  const response = await fetch(path, { ...options, headers: { authorization:`Bearer ${state.token}`, "content-type":"application/json", ...(options.headers||{}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.error || "Request failed");
  return payload;
}
const short = value => value ? `${value.slice(0,10)}…${value.slice(-6)}` : "—";
const amount = value => `${(Number(value)/1_000_000).toLocaleString(undefined,{maximumFractionDigits:6})} USDC`;

async function load() {
  try { const data = await api("/api/v1/workflows"); state.workflows = data.workflows; renderQueue(); if (state.selected) await select(state.selected); }
  catch (error) { queue.innerHTML = `<p class="lede">${escapeHtml(error.message)}</p>`; }
}
function renderQueue(){
  document.querySelector("#queueCount").textContent=state.workflows.length;
  queue.innerHTML=state.workflows.map(item=>`<button class="queue-item ${state.selected===item.id?"active":""}" data-id="${item.id}"><span><strong>${escapeHtml(item.paymentReference)}</strong><small>${amount(item.amountBaseUnits)} · ${short(item.recipientAddress)}</small></span><span class="state">${item.state.replaceAll("_"," ")}</span></button>`).join("") || `<p class="lede">No payment workflows yet.</p>`;
  queue.querySelectorAll("button").forEach(button=>button.addEventListener("click",()=>select(button.dataset.id)));
}
async function select(id){ state.selected=id; renderQueue(); const data=await api(`/api/v1/workflows/${id}`); renderInspector(data.workflow,data.auditEvents); }
function renderInspector(item,events){
  const awaiting=item.state==="AWAITING_HUMAN_APPROVAL", canAuthorize=["AUTO_APPROVED","HUMAN_APPROVED"].includes(item.state), canExecute=["AUTHORIZED","SUBMITTED"].includes(item.state);
  inspector.className="inspector"; inspector.innerHTML=`<span class="eyebrow">${item.state.replaceAll("_"," ")}</span><h2 class="detail-title">${escapeHtml(item.paymentReference)}</h2><p class="lede">${amount(item.amountBaseUnits)} to ${short(item.recipientAddress)} on Arc. Version ${item.version}.</p><div class="detail-grid">${datum("Decision",item.decision)}${datum("Decision hash",item.decisionHash,true)}${datum("Policy definition",item.policyDefinitionHash,true)}${datum("Policy input",item.policyInputHash,true)}${datum("Vault",item.vaultAddress,true)}${datum("Nonce",item.nonce,true)}${datum("Receipt",item.receiptHash||"Not issued",true)}${datum("Transaction",item.submission?.transactionHash||"Not submitted",true)}</div><div class="actions">${awaiting?`<button data-action="approve">Approve exact payment</button><button data-action="reject" class="quiet reject">Reject</button>`:""}${canAuthorize?`<button data-action="authorize">Sign & verify receipt</button>`:""}${canExecute?`<button data-action="execute">${item.state==="SUBMITTED"?"Retry settlement verification":"Submit & verify settlement"}</button>`:""}</div><span class="eyebrow">Audit trail</span><div class="timeline">${events.map(e=>`<article><time>${new Date(e.occurredAt).toLocaleString()}</time><p>${escapeHtml(e.eventType.replaceAll("_"," "))}</p></article>`).join("")}</div>`;
  inspector.querySelectorAll("[data-action]").forEach(button=>button.addEventListener("click",()=>act(item.id,button.dataset.action)));
}
const datum=(label,value,code=false)=>`<div class="datum"><span>${label}</span>${code?`<code>${escapeHtml(String(value))}</code>`:`<strong>${escapeHtml(String(value))}</strong>`}</div>`;
async function act(id,action){
  try { await api(`/api/v1/workflows/${id}/${action}`,{method:"POST",body:"{}"}); await load(); }
  catch(error){ alert(error.message); }
}
function escapeHtml(value){ const node=document.createElement("span");node.textContent=value;return node.innerHTML; }
if(state.token) load(); else dialog.showModal();
