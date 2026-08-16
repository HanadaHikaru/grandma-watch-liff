const config=window.GRANDMA_WATCH_CONFIG;
const liffRelease=Object.freeze({version:"1.0.0-rc.1",revision:"5de4fdd",builtAt:"2026-08-16T06:46:25.361Z"});
const app=document.querySelector("#app"),subtitle=document.querySelector("#subtitle");
const escapeHtml=(value)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const format=(value)=>value?new Intl.DateTimeFormat("ja-JP",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Tokyo"}).format(new Date(value)):"未取得";
const releaseRevision=()=>liffRelease.revision.startsWith("__LIFF_")?"ローカル":liffRelease.revision;
const releaseBuiltAt=()=>liffRelease.builtAt.startsWith("__LIFF_")?"未公開":format(liffRelease.builtAt);

let liffInitialization;
async function initializeLine(){if(!config)throw new Error("config.jsが未設定です");liffInitialization??=liff.init({liffId:config.liffId});await liffInitialization;if(!liff.isLoggedIn()){liff.login({redirectUri:location.href});return new Promise(()=>{});}}
async function token(){await initializeLine();const value=liff.getIDToken();if(!value)throw new Error("LINE認証を取得できません");return value;}
async function api(base,action,{method="GET",body}={}){const idToken=await token();const response=await fetch(`${base}?action=${encodeURIComponent(action)}`,{method,headers:{authorization:`Bearer ${idToken}`,"content-type":"application/json"},body:body?JSON.stringify(body):undefined,cache:"no-store"});const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.message??"処理に失敗しました");error.code=data.code;error.requestId=data.requestId;throw error;}return data;}
function stateName(value){return {NORMAL:"見守り中",CAUTION:"少し気になる状態",REVIEW:"確認が必要です",EMERGENCY:"緊急確認が必要です"}[value]??"状態を確認中";}
function severityName(value){return {CAUTION:"注意",REVIEW:"要確認",EMERGENCY:"緊急"}[value]??"要確認";}
function alertReason(value){return {NO_COMMUNICATION:"端末からの通信が長時間届いていません",NO_LOCATION:"位置情報が長時間更新されていません",LOW_BATTERY:"端末のバッテリーが少なくなっています",MORNING_NO_REPORT:"今日の通信がまだ確認できていません"}[value]??"見守り状態の確認が必要です";}
function invitationErrorMessage(error){const message=String(error?.message??"");if(message.includes("既に申請または登録"))return "このLINEアカウントは既に申請または登録されています。登録する家族本人のLINEで招待リンクを開いてください。";if(message.includes("招待が無効または期限切れ"))return "この招待リンクは使用済み、期限切れ、または無効です。ADMINに新しいリンクの発行を依頼してください。";if(message.includes("LINE認証"))return "LINE認証を確認できませんでした。LINEアプリ内でリンクを開き直してください。";const requestId=typeof error?.requestId==="string"&&/^[A-Za-z0-9._-]{1,100}$/.test(error.requestId)?` 問い合わせID: ${error.requestId}`:"";return `参加申請を送信できませんでした。通信状態を確認し、もう一度お試しください。${requestId}`;}
function showError(error){app.innerHTML=`<div class="error">${escapeHtml(error.message)}</div>`;}
function showLoading(){subtitle.textContent="読み込み中…";app.innerHTML='<section class="card" aria-busy="true">通信中です…</section>';}
function copyInputValue(input){input.focus();input.select();input.setSelectionRange(0,input.value.length);if(typeof document.execCommand==="function"&&document.execCommand("copy"))return Promise.resolve();if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(input.value);return Promise.reject(new Error("clipboard unavailable"));}

function alertCards(items){
  if(!items.length)return "";
  return `<section class="alert-section"><h2>確認が必要なこと</h2>${items.map(alert=>`<article class="card alert-card severity-${escapeHtml(alert.severity).toLowerCase()}"><div class="alert-heading"><span class="severity">${escapeHtml(severityName(alert.severity))}</span><strong>${escapeHtml(alertReason(alert.alertType))}</strong></div><div class="row"><span>検知時刻</span><strong>${format(alert.detectedAt)}</strong></div><div class="assignee">${alert.assignee?`${escapeHtml(alert.assignee)}さんが対応中`:"まだ対応者が決まっていません"}</div><div class="actions">${alert.status==="OPEN"?`<button data-claim="${alert.id}">対応する</button>`:""}${alert.canRespond?`<button data-result="${alert.id}" data-value="CONTACT_OK">連絡でき、問題なし</button><button class="secondary" data-result="${alert.id}" data-value="NO_CONTACT">連絡がつかない</button><button class="secondary" data-result="${alert.id}" data-value="GOING_TO_HOME">家へ向かう</button><button class="secondary" data-other="${alert.id}">その他の結果</button>`:""}</div></article>`).join("")}</section>`;
}

function bindAlertActions(refresh){
  app.onclick=async event=>{
    const button=event.target.closest("button[data-claim],button[data-result],button[data-other]");if(!button||button.disabled)return;
    button.disabled=true;
    try{
      if(button.dataset.claim)await api(config.familyApiUrl,"claim",{method:"POST",body:{alertId:button.dataset.claim}});
      if(button.dataset.result)await api(config.familyApiUrl,"result",{method:"POST",body:{alertId:button.dataset.result,result:button.dataset.value}});
      if(button.dataset.other){const comment=prompt("対応結果を1〜500文字で入力してください");if(comment===null){button.disabled=false;return;}if(comment.trim().length<1||comment.length>500){alert("対応結果は1〜500文字で入力してください。");button.disabled=false;return;}await api(config.familyApiUrl,"result",{method:"POST",body:{alertId:button.dataset.other,result:"OTHER",comment}});}
      await refresh();
    }catch(_){button.disabled=false;alert("操作を完了できませんでした。最新の状態を確認して、もう一度お試しください。");}
  };
}

async function statusView(){
  const [value,alerts]=await Promise.all([api(config.familyApiUrl,"status"),api(config.familyApiUrl,"active-alert")]);
  subtitle.textContent="現在の状態";
  const management=value.viewer?.isAdmin===true?`<section class="card admin-management"><h2>管理</h2><p class="muted">BASIOを新しく登録するための一回限りのコードを発行します。</p><div class="actions"><button id="issue-enrollment-code" type="button">端末登録コードを発行</button></div><div id="enrollment-code-result" class="enrollment-result" aria-live="polite" hidden><p class="muted">端末登録コード</p><div class="enrollment-code"></div><p>15分間有効です。</p><p>有効期限（日本時間）: <strong class="enrollment-expiry"></strong></p><p class="muted">再発行する場合は画面を再読み込みしてください。</p></div><div id="enrollment-code-error" class="inline-error" role="alert" hidden></div></section>`:"";
  const actions=`${value.viewer?.canViewExactLocation===true?'<a class="button" href="?view=location">現在地を見る</a>':""}${value.phoneAvailable===true?'<a class="button secondary" href="?view=phone">電話する</a>':""}`;
  app.innerHTML=`<div class="subject-name">${escapeHtml(value.subjectDisplayName)}さんの見守り</div><section class="card status-card status-${escapeHtml(value.status).toLowerCase()}"><div class="state">${escapeHtml(stateName(value.status))}</div><div class="row"><span>最終通信</span><strong>${format(value.lastCommunicationAt)}</strong></div><div class="row"><span>最終位置取得</span><strong>${format(value.lastLocationAt)}</strong></div><div class="row"><span>現在地</span><strong>${escapeHtml(value.locationLabel)}</strong></div><div class="row"><span>バッテリー</span><strong>${value.batteryPercent==null?"未取得":`${value.batteryPercent}%`}</strong></div><div class="row"><span>充電</span><strong>${value.charging==null?"未取得":value.charging?"充電中":"充電していません"}</strong></div>${actions?`<div class="actions two-actions">${actions}</div>`:""}</section>${alertCards(alerts.items)}${management}`;
  bindAlertActions(statusView);
  if(value.viewer?.isAdmin!==true)return;
  const button=document.querySelector("#issue-enrollment-code"),result=document.querySelector("#enrollment-code-result"),error=document.querySelector("#enrollment-code-error");
  let requestStarted=false;
  button.onclick=async()=>{
    if(requestStarted)return;
    requestStarted=true;button.disabled=true;button.textContent="発行中…";error.hidden=true;
    try{
      const issued=await api(config.adminApiUrl,"device-enrollment-code",{method:"POST",body:{}});
      if(!/^[A-Za-z0-9]{12}$/.test(issued.enrollmentCode)||!Number.isFinite(Date.parse(issued.expiresAt)))throw new Error("invalid enrollment response");
      result.querySelector(".enrollment-code").textContent=issued.enrollmentCode;
      result.querySelector(".enrollment-expiry").textContent=format(issued.expiresAt);
      result.hidden=false;button.textContent="発行済み";
    }catch(_){
      error.textContent="登録コードを発行できませんでした。通信状態を確認し、少し待ってから再度お試しください。";error.hidden=false;button.textContent="端末登録コードを発行";
      setTimeout(()=>{requestStarted=false;button.disabled=false;},5000);
    }
  };
}
async function locationView(){const value=await api(config.familyApiUrl,"location");subtitle.textContent="現在地";app.innerHTML=`<section class="card"><div class="state">📍 ${escapeHtml(value.locationLabel)}</div><div class="row"><span>位置更新</span><strong>${format(value.updatedAt)}</strong></div>${value.latitude==null?"":`<div class="row"><span>緯度・経度</span><strong>${value.latitude}, ${value.longitude}</strong></div><div class="row"><span>精度</span><strong>±${value.accuracyM}m</strong></div><div class="actions"><a class="button" rel="external noreferrer" href="${escapeHtml(value.googleMapsUrl)}">地図を開く</a></div>`}</section>`;}
async function phoneView(){const value=await api(config.familyApiUrl,"phone");subtitle.textContent="電話";app.innerHTML=`<section class="card"><p>${escapeHtml(value.displayName)}に電話しますか？</p><div class="actions"><a class="button" rel="external" href="tel:${escapeHtml(value.phoneNumber)}">電話する</a></div></section>`;}
async function alertsView(){const value=await api(config.familyApiUrl,"active-alert");subtitle.textContent="対応状況";if(!value.items.length){app.innerHTML='<section class="card">現在対応が必要な通知はありません。</section>';return;}app.innerHTML=value.items.map(a=>`<section class="card"><div class="state">${severityName(a.severity)}</div><p>${escapeHtml(alertReason(a.alertType))}</p><p>${a.assignee?`${escapeHtml(a.assignee)}さんが対応中`:"担当者なし"}</p><div class="actions">${a.status==="OPEN"?`<button data-claim="${a.id}">私が確認します</button>`:""}${a.canRespond?`<button data-result="${a.id}" data-value="CONTACT_OK">問題なし</button><button class="secondary" data-result="${a.id}" data-value="NO_CONTACT">連絡がつかない</button><button class="secondary" data-result="${a.id}" data-value="GOING_TO_HOME">家へ向かう</button><button class="secondary" data-other="${a.id}">その他</button>`:""}${a.status==="ASSIGNED"&&a.canRelease?`<button class="danger" data-release="${a.id}">担当を解除</button>`:""}</div></section>`).join("");app.onclick=async e=>{const target=e.target.closest("button");if(!target)return;try{if(target.dataset.claim)await api(config.familyApiUrl,"claim",{method:"POST",body:{alertId:target.dataset.claim}});if(target.dataset.result)await api(config.familyApiUrl,"result",{method:"POST",body:{alertId:target.dataset.result,result:target.dataset.value}});if(target.dataset.other){const comment=prompt("その他の内容（1〜500文字）");if(comment)await api(config.familyApiUrl,"result",{method:"POST",body:{alertId:target.dataset.other,result:"OTHER",comment}});}if(target.dataset.release&&confirm("担当を解除しますか？"))await api(config.familyApiUrl,"unassign",{method:"POST",body:{alertId:target.dataset.release}});await alertsView();}catch(error){showError(error);}};}
async function settingsView(){const value=await api(config.familyApiUrl,"notification-settings");subtitle.textContent="通知設定";app.innerHTML=`<section class="card"><label>通知レベル<select id="level"><option value="IMPORTANT_ONLY">重要なときだけ</option><option value="CAUTION_AND_ABOVE">注意も通知</option><option value="CUSTOM">カスタム</option></select></label><label><input id="comm" type="checkbox"> 長時間通信なし</label><label><input id="loc" type="checkbox"> 位置更新なし</label><label><input id="battery" type="checkbox"> 低バッテリー</label><div class="actions"><button id="save">保存</button></div></section>`;document.querySelector("#level").value=value.notification_level;document.querySelector("#comm").checked=value.notify_no_communication;document.querySelector("#loc").checked=value.notify_no_location;document.querySelector("#battery").checked=value.notify_low_battery;document.querySelector("#save").onclick=async()=>{await api(config.familyApiUrl,"notification-settings",{method:"PUT",body:{notificationLevel:document.querySelector("#level").value,notifyNoCommunication:document.querySelector("#comm").checked,notifyNoLocation:document.querySelector("#loc").checked,notifyLowBattery:document.querySelector("#battery").checked}});subtitle.textContent="保存しました";};}
async function historyView(){const to=new Date(),from=new Date(to.getTime()-24*3600_000);const idToken=await token();const response=await fetch(`${config.familyApiUrl}?action=location-history&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,{headers:{authorization:`Bearer ${idToken}`},cache:"no-store"});const value=await response.json();if(!response.ok)throw new Error(value.message);subtitle.textContent="位置履歴";app.innerHTML=`<section class="card">${value.items.map(item=>`<div class="item"><strong>${format(item.recorded_at)}</strong><br>${item.location_available?`${escapeHtml(item.latitude)}, ${escapeHtml(item.longitude)}`:"位置なし"}</div>`).join("")||"履歴はありません"}</section>`;}
async function systemView(){const [value,device]=await Promise.all([api(config.adminApiUrl,"system-status"),api(config.adminApiUrl,"device-status")]);subtitle.textContent="管理・設定";const deviceHtml=device.enrolled?`<section class="card"><h2>BASIO端末</h2><div class="row"><span>機種</span><strong>${escapeHtml(device.deviceModel)}</strong></div><div class="row"><span>Android</span><strong>${escapeHtml(device.androidVersion)}</strong></div><div class="row"><span>BASIOアプリ版</span><strong>${escapeHtml(device.lastReportAppVersion??device.enrolledAppVersion)}</strong></div><div class="row"><span>最終認証</span><strong>${format(device.lastAuthenticatedAt)}</strong></div><div class="row"><span>最終通信</span><strong>${format(device.lastCommunicationAt)}</strong></div><div class="row"><span>最終位置</span><strong>${format(device.lastLocationAt)}</strong></div><div class="row"><span>最終レポート時の通信</span><strong>${device.networkAvailable==null?"不明":device.networkAvailable?"利用可":"利用不可"}</strong></div><div class="row"><span>稼働</span><strong>${device.active?"有効":"停止"}</strong></div></section>`:'<section class="card"><h2>BASIO端末</h2><p>登録済み端末はありません。</p></section>';const releaseHtml=`<section class="card"><h2>家族画面</h2><div class="row"><span>バージョン</span><strong>${escapeHtml(liffRelease.version)}</strong></div><div class="row"><span>ビルドID</span><strong>${escapeHtml(releaseRevision())}</strong></div><div class="row"><span>公開日時</span><strong>${escapeHtml(releaseBuiltAt())}</strong></div><p class="muted">表示が古い場合は、画面を閉じてLINEから開き直してください。</p></section>`;app.innerHTML=`${deviceHtml}${releaseHtml}<section class="card"><h2>連携状態</h2>${value.items.map(item=>`<div class="row"><span>${escapeHtml(item.component)}</span><strong>${escapeHtml(item.status)}</strong></div>`).join("")||"状態記録なし"}</section>`;}
async function familyView(){
  const value=await api(config.adminApiUrl,"family-members");subtitle.textContent="家族管理";
  app.innerHTML=`<section class="card">${value.items.map(m=>`<div class="item"><strong>${escapeHtml(m.display_name)}</strong> <span class="badge">${m.role}</span><br><span class="muted">${m.status} / 詳細位置 ${m.can_view_exact_location?"許可":"不可"} / 履歴 ${m.can_view_history?"許可":"不可"}</span>${m.status==="PENDING"?`<button data-approve="${m.id}">承認</button>`:""}</div>`).join("")}<div class="actions"><button id="invite" type="button">家族を招待する</button></div><div id="invite-result" class="enrollment-result" aria-live="polite" hidden><p>このリンクを登録する家族へ送ってください。24時間・1回限り有効です。</p><label>招待リンク<input id="invite-link" type="text" readonly></label><div class="actions"><button id="copy-invite" type="button">招待リンクをコピー</button></div><p id="invite-status" class="muted"></p></div><div id="invite-error" class="inline-error" role="alert" hidden></div></section>`;
  app.onclick=async e=>{
    const button=e.target.closest("button");if(!button||button.disabled)return;
    if(button.dataset.approve){button.disabled=true;try{await api(config.adminApiUrl,"approve-family",{method:"POST",body:{memberId:button.dataset.approve}});await familyView();}catch(_){button.disabled=false;alert("承認できませんでした。最新の状態を確認してください。");}return;}
    const result=document.querySelector("#invite-result"),inviteLink=document.querySelector("#invite-link"),status=document.querySelector("#invite-status"),error=document.querySelector("#invite-error");
    if(button.id==="invite"){
      button.disabled=true;button.textContent="発行中…";error.hidden=true;
      try{const invitation=await api(config.adminApiUrl,"create-invitation",{method:"POST",body:{}});inviteLink.value=`https://liff.line.me/${encodeURIComponent(config.liffId)}/?view=join&token=${encodeURIComponent(invitation.token)}`;result.hidden=false;button.textContent="発行済み";status.textContent="新しいリンクを表示しました。先頭は毎回同じで、末尾のtokenが発行ごとに変わります。";}
      catch(_){error.textContent="招待リンクを発行できませんでした。通信状態を確認し、少し待ってから再度お試しください。";error.hidden=false;button.disabled=false;button.textContent="家族を招待する";}return;
    }
    if(button.id==="copy-invite"){
      button.disabled=true;try{await copyInputValue(inviteLink);status.textContent="招待リンクをコピーしました。";}catch(_){status.textContent="自動コピーできませんでした。リンク欄を長押ししてコピーしてください。";}finally{button.disabled=false;}return;
    }
  };
}
async function joinView(){
  const inviteToken=new URLSearchParams(location.search).get("token")??"";subtitle.textContent="家族参加申請";
  app.innerHTML=`<section class="card"><p>見守りグループへの参加を申請します。登録する家族本人のLINEで入力してください。</p><label>表示名<input id="name" maxlength="100" autocomplete="name" required></label><label>続柄<input id="relation" maxlength="50" required></label><div class="actions"><button id="apply" type="button">参加申請</button></div><div id="join-error" class="inline-error" role="alert" hidden></div></section>`;
  const button=document.querySelector("#apply"),error=document.querySelector("#join-error");
  button.onclick=async()=>{
    if(button.disabled)return;error.hidden=true;
    const displayName=document.querySelector("#name").value.trim(),relation=document.querySelector("#relation").value.trim();
    if(inviteToken.length<32){error.textContent="招待リンクが無効です。ADMINに新しいリンクの発行を依頼してください。";error.hidden=false;return;}
    if(!displayName||!relation){error.textContent="表示名と続柄を両方入力してください。";error.hidden=false;return;}
    button.disabled=true;button.textContent="申請中…";
    try{await api(config.familyApiUrl,"apply-invitation",{method:"POST",body:{token:inviteToken,displayName,relation}});app.innerHTML='<section class="card"><h2>参加申請を送信しました</h2><p>ADMINの承認後に見守り情報を確認できます。</p></section>';}
    catch(cause){error.textContent=invitationErrorMessage(cause);error.hidden=false;button.disabled=false;button.textContent="参加申請";}
  };
}

const views={status:statusView,location:locationView,phone:phoneView,history:historyView,alerts:alertsView,settings:settingsView,family:familyView,system:systemView,join:joinView};
async function start(){showLoading();await initializeLine();const selected=views[new URLSearchParams(location.search).get("view")??"status"];if(!selected)throw new Error("画面が見つかりません");await selected();}
start().catch(showError);
