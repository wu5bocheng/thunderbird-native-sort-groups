"""Run the XPI in a brand-new headless Thunderbird profile with synthetic mail only."""
import argparse,base64,json,os,socket,subprocess,tempfile,time,shutil
from pathlib import Path
from marionette_client import Client
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--binary',default='/snap/thunderbird/current/usr/lib/thunderbird/thunderbird');parser.add_argument('--locale',default='en-US');parser.add_argument('--langpack');args=parser.parse_args()
version=json.loads((root/'manifest.json').read_text())['version']
xpi=root.parent/f'thunderbird-native-groups-{version}.xpi'
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='native-groups-test-') as temp:
 profile=Path(temp)
 if args.langpack:
  (profile/'extensions').mkdir();shutil.copyfile(args.langpack,profile/('extensions/langpack-'+args.locale+'@thunderbird.mozilla.org.xpi'))
 (profile/'user.js').write_text(f'user_pref("marionette.port",{port});\nuser_pref("mailnews.start_page.enabled",false);\nuser_pref("app.update.auto",false);\nuser_pref("mail.provider.suppress_dialog_on_startup",true);\n')
 with (profile/'user.js').open('a') as prefs:
  prefs.write('user_pref("intl.locale.requested",'+json.dumps(args.locale)+');\nuser_pref("extensions.autoDisableScopes",0);\n')
 with (profile/'process.log').open('w') as log:
  process=subprocess.Popen([args.binary,'--headless','--no-remote','--profile',str(profile),'--marionette','--remote-allow-system-access'],stdout=log,stderr=log,env={**os.environ,'TZ':'America/Los_Angeles'})
  try:
   client=None
   for _ in range(100):
    try:client=Client(port);break
    except (ConnectionError,OSError):time.sleep(.2)
   if client is None:raise RuntimeError('Thunderbird Marionette failed to start')
   P="Services.wm.getMostRecentWindow('mail:3pane').document.getElementById('tabmail').currentTabInfo.chromeBrowser.contentWindow"
   def js(body):return client.js('const p='+P+';'+body)['value']
   def wait(body):
    for _ in range(100):
     try:
      if js(body):return
     except RuntimeError:pass
     time.sleep(.1)
    raise AssertionError('Timed out: '+body)
   wait('return !!p?.threadTree;')
   result=js('''
   const {MailServices}=ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
   try{MailServices.accounts.localFoldersServer;}catch{MailServices.accounts.createLocalMailAccount();}
   const root=MailServices.accounts.localFoldersServer.rootFolder;root.createSubfolder('Native Fixture',null);
   const folder=root.getChildNamed('Native Fixture'),local=folder.QueryInterface(Ci.nsIMsgLocalMailFolder);
   const today=new Date();today.setHours(12,0,0,0);
   for(const [id,author,days] of [[0,'news@offers.example.com',0],[1,'news@news.example.com',0],[2,'alice@gmail.com',0],[3,'bob@gmail.com',0],[4,'account@example.com',1]]){
    const d=new Date(+today-days*86400000-id*60000);
    local.addMessage(['From: '+author,'To: test@localhost','Subject: Fixture message '+id,'Date: '+d.toUTCString(),'Message-ID: <fixture-'+id+'@localhost>','Content-Type: text/plain','','Fixture body '+id,'',''].join(String.fromCharCode(13,10)));
   }
   const account=[...MailServices.accounts.accounts].find(a=>a.incomingServer.key===root.server.key);
   const identity=MailServices.accounts.createIdentity();identity.email='test@localhost';identity.archiveEnabled=true;identity.archivesFolderURI=root.URI+'/Archives';identity.archiveGranularity=0;identity.archiveKeepFolderStructure=false;
   account.addIdentity(identity);account.defaultIdentity=identity;
   if(!root.containsChildNamed('Archives'))root.createSubfolder('Archives',null);
   p.__originalHandlers={select:p.threadPane._onSelect,removed:p.dbViewWrapperListener.onMessagesRemoved,enabled:p.commandController.isCommandEnabled,command:p.commandController.doCommand,sort:p.sortController.handleCommand};
   p.displayFolder(folder.URI);return folder.getTotalMessages(false);
   ''');assert result==5
   wait('return p.dbViewWrapperListener.allMessagesLoaded && p.gDBView?.rowCount===5;')
   js('p.gViewWrapper.showGroupedBySort=true;return true;')
   wait('return p.dbViewWrapperListener.allMessagesLoaded && p.gDBView.numMsgsInView===5;')
   saved_flags=js('return p.gDBView.viewFlags;')
   result=client.js('''return (async()=>{const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');const f=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);f.initWithPath(arguments[0]);return (await AddonManager.installTemporaryAddon(f)).isActive;})();''',[str(xpi)])['value'];assert result
   wait('return p.__nativeDateDomainState?.proxy===p.gDBView;')
   expected_label='发件域名' if args.locale=='zh-CN' else 'Sender domain'
   assert js('return p.document.querySelector("[data-native-sort-field=nativeDomainCol]").getAttribute("label");')==expected_label
   js('const top=Services.wm.getMostRecentWindow("mail:3pane");for(const d of top.document.querySelectorAll("dialog[open]"))d.close();top.resizeTo(1280,800);return true;')
   def click(selector, summary=False, ctrl=False):
    target_window='p.multiMessageBrowser.contentWindow' if summary else 'p'
    wait('const e='+target_window+'.document.querySelector('+json.dumps(selector)+');if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;')
    if summary:wait('const r=p.multiMessageBrowser.getBoundingClientRect();return !p.multiMessageBrowser.hidden&&r.width>0&&r.height>0;')
    js('return new Promise(resolve=>p.requestAnimationFrame(()=>p.requestAnimationFrame(()=>resolve(true))));')
    target=js("const selector="+json.dumps(selector)+"; const w="+("p.multiMessageBrowser.contentWindow" if summary else "p")+"; const e=w.document.querySelector(selector);if(!e)throw Error('Missing '+selector);e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();const top=Services.wm.getMostRecentWindow('mail:3pane'),b=top.document.getElementById('tabmail').currentTabInfo.chromeBrowser.getBoundingClientRect();"+("const inner=p.multiMessageBrowser.getBoundingClientRect();" if summary else "const inner={left:0,top:0};")+"return {x:Math.round(b.left+inner.left+r.left+r.width/2),y:Math.round(b.top+inner.top+r.top+r.height/2)};")
    if ctrl:client.send('WebDriver:PerformActions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue009'}]}]})
    client.send('WebDriver:PerformActions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','duration':0,'origin':'viewport',**target},{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]}]})
    if ctrl:client.send('WebDriver:PerformActions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyUp','value':'\ue009'}]}]})
   def key(value):
    client.send('WebDriver:PerformActions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':value},{'type':'keyUp','value':value}]}]})
   def count(n):wait(f'return p.gDBView.numSelected==={n};')
   def summary(n):
    count(n);wait('return !p.multiMessageBrowser.hidden && p.multiMessageBrowser.contentDocument.querySelectorAll("#messageList > li").length>0;')
   js('p.document.querySelector("[data-native-sort-field=nativeDomainCol]").doCommand();return true;')
   assert js('return p.gDBView.rowCount;')==2
   # The original sort menu is now ordered multi-select; grouping is a separate checkbox.
   def menu(value):
    js('p.document.getElementById("menu_threadPaneSortPopup").querySelector("[value='+value+']").doCommand();return true;')
   def config():return js('return p.__nativeDateDomainState.config;')
   def feedback(keys,grouped):
    data=js('const popup=p.document.getElementById("menu_threadPaneSortPopup");return [...popup.children].filter(i=>i.hasAttribute("checked")).map(i=>({value:i.getAttribute("value"),label:i.getAttribute("label")}));')
    assert set(i['value'] for i in data if (i['value'] or '').startswith('by'))==set(keys),data
    assert [i['value'] for i in data if i['value'] in ['ascending','descending']]==[config()['order']],data
    for rank,key in enumerate(keys,1):
     item=next(i for i in data if i['value']==key);assert item['label'].startswith(str(rank)+' · '),data
    assert any(i['value']=='groupedBySort' for i in data)==grouped,data
   feedback(['byDate','byNativeDomain'],True)
   assert not js('return !![...p.document.querySelectorAll("menuitem")].find(i=>(i.getAttribute("label")||"").includes("实验视图"));')
   menu('groupedBySort');assert not config()['grouped']
   assert js('return p.gDBView.rowCount===5 && p.__nativeDateDomainState.model.rows.every(r=>!r.children);')
   feedback(['byDate','byNativeDomain'],False)
   menu('byDate');feedback(['byNativeDomain'],False);menu('byDate');menu('byUnread');menu('byFlagged')
   assert config()['keys']==['nativeDomainCol','dateCol','unreadButtonColHeader','flaggedCol']
   feedback(['byNativeDomain','byDate','byUnread','byFlagged'],False)
   menu('groupedBySort');assert config()['grouped']
   js('p.commandController.doCommand("cmd_expandAllThreads");return true;')
   assert js('return Math.max(...p.__nativeDateDomainState.model.rows.map(r=>r.level));')==4
   # Reopening the real popup must not reset checks to the old native radio selection.
   js('p.document.getElementById("menu_threadPaneSortPopup").openPopupAtScreen(420,100,false);return true;')
   time.sleep(.1);feedback(['byNativeDomain','byDate','byUnread','byFlagged'],True)
   shot=client.send('WebDriver:TakeScreenshot',{'id':None,'highlights':[],'full':False,'scroll':False})['value'];(root/('preview-multilevel'+('-'+args.locale if args.locale!='en-US' else '')+'.png')).write_bytes(base64.b64decode(shot))
   js('p.document.getElementById("menu_threadPaneSortPopup").hidePopup();return true;')
   menu('groupedBySort');menu('ascending');assert config()['order']=='ascending'
   # Exercise every offered field and arbitrary nesting with actual native header values.
   fields=['byDate','byReceived','byFlagged','byId','byPriority','byAuthor','byNativeDomain','byRecipient','byCorrespondent','bySize','byStatus','bySubject','byUnread','byTags','byJunkStatus','byAttachments']
   for field in fields:
    if field not in ['byNativeDomain','byDate','byUnread','byFlagged']:menu(field)
   assert len(config()['keys'])==16
   menu('groupedBySort');js('p.commandController.doCommand("cmd_expandAllThreads");return true;')
   assert js('return Math.max(...p.__nativeDateDomainState.model.rows.map(r=>r.level));')==16
   assert js('return p.__nativeDateDomainState.model.roots.reduce((n,r)=>n+r.count,0);')==5
   # Return to the original two-level configuration for the full edit regression suite.
   for field in fields:
    if field not in ['byDate','byNativeDomain']:menu(field)
   menu('byNativeDomain');menu('byNativeDomain');menu('descending')
   assert config()['keys']==['dateCol','nativeDomainCol']
   js('p.commandController.doCommand("cmd_collapseAllThreads");return true;')
   feedback(['byDate','byNativeDomain'],True)
   # Actual pointer events, not calls to expansion or selection methods.
   click('#threadTree-row0 .subject');summary(4)
   assert js('return p.gDBView.rowCount;')==2
   click('#threadTree-row0 .twisty');wait('return p.gDBView.rowCount===5;')
   assert js('return p.__nativeDateDomainState.model.rows.filter(r=>r.level===1).map(r=>r.label).join(",");')=='example.com,alice@gmail.com,bob@gmail.com'
   click('#threadTree-row1 .subject');summary(2)
   click('#threadTree-row1 .twisty');wait('return p.gDBView.rowCount===7;')
   # Parent + child + individual leaf overlaps must not duplicate messages.
   click('#threadTree-row0 .subject',ctrl=True);summary(4)
   click('#threadTree-row2 .subject',ctrl=True);summary(4)
   click('#threadTree-row4 .subject');summary(1)
   # Navigate the native tree with the real arrow keys.
   key('\ue014');wait('return p.gDBView.isContainerOpen(4);')
   key('\ue012');wait('return !p.gDBView.isContainerOpen(4);')
   click('#threadTree-row2 .subject');count(1)
   wait('return !p.messageBrowser.hidden && p.messageBrowser.contentWindow.gMessage?.messageId==="fixture-0@localhost";')
   # Native commands now operate on real selection, including group members.
   click('#threadTree-row1 .subject');summary(2)
   js('p.commandController.doCommand("cmd_markAsRead");return true;')
   wait('return p.gDBView.getSelectedMsgHdrs().every(m=>m.isRead);')
   js('p.commandController.doCommand("cmd_markAsUnread");return true;')
   wait('return p.gDBView.getSelectedMsgHdrs().every(m=>!m.isRead);')
   js('p.commandController.doCommand("cmd_markAsFlagged");return true;')
   wait('return p.gDBView.getSelectedMsgHdrs().every(m=>m.isFlagged);')
   wait('return p.document.getElementById("threadTree-row2")?.dataset.properties.split(" ").includes("flagged");')
   click('#threadTree-row2 .button-star')
   wait('return [...p.gFolder.messages].find(m=>m.messageId==="fixture-0@localhost").isFlagged===false && [...p.gFolder.messages].find(m=>m.messageId==="fixture-1@localhost").isFlagged===true;')
   click('#threadTree-row1 .subject');summary(2)
   js('p.commandController.doCommand("cmd_tag1");return true;')
   wait('return p.gDBView.getSelectedMsgHdrs().every(m=>m.getStringProperty("keywords").includes("$label1"));')
   js('p.commandController.doCommand("cmd_markAsJunk");return true;')
   wait('return p.gDBView.getSelectedMsgHdrs().every(m=>m.getStringProperty("junkscore")==="100");')
   js('p.commandController.doCommand("cmd_markAsNotJunk");return true;')
   wait('return p.gDBView.getSelectedMsgHdrs().every(m=>m.getStringProperty("junkscore")==="0");')
   click('#messageList > li[data-message-id="fixture-1@localhost"] .primary',summary=True)
   wait('return !p.messageBrowser.hidden && p.messageBrowser.contentWindow.gMessage?.messageId==="fixture-1@localhost";')
   click('#threadTree-row1 .subject');summary(2)
   # Save a real native summary screenshot with synthetic emails only.
   summary(2)
   shot=client.send('WebDriver:TakeScreenshot',{'id':None,'highlights':[],'full':False,'scroll':False})['value']
   (root/('preview-native'+('-'+args.locale if args.locale!='en-US' else '')+'.png')).write_bytes(base64.b64decode(shot))
   # Native summary delete button must delete exactly the displayed group's two messages.
   js('Services.prefs.setBoolPref("mail.warn_on_delete_from_trash",false);Services.prefs.setBoolPref("mail.warn_on_delete_from_virtual_folder",false);Services.prefs.setBoolPref("mail.warn_on_collapsed_thread_operation",false);return true;')
   js('const {MailUtils}=ChromeUtils.importESModule("resource:///modules/MailUtils.sys.mjs");const original=MailUtils.confirmDelete;MailUtils.confirmDelete=function(...args){p.__nativeConfirmCalled=true;return original.apply(this,args);};return true;')
   click('#hdrTrashButton',summary=True)
   wait('return p.gFolder.getTotalMessages(false)===3;')
   assert js('return p.__nativeConfirmCalled;')
   assert js('return [...p.gFolder.messages].map(m=>m.messageId).sort().join(",");')=='fixture-2@localhost,fixture-3@localhost,fixture-4@localhost'
   js('const top=Services.wm.getMostRecentWindow("mail:3pane");top.messenger.undo(top.msgWindow);return true;')
   wait('return p.gFolder.getTotalMessages(false)===5;')
   wait('return p.__nativeDateDomainState.model.roots.reduce((n,r)=>n+r.count,0)===5;')
   # Move a selected group via the native command, then undo using native transaction history.
   js('const root=p.gFolder.parent;if(!root.containsChildNamed("Destination"))root.createSubfolder("Destination",null);return true;')
   # Find the source row after native undo may have changed row positions.
   js('const state=p.__nativeDateDomainState;const i=state.model.rows.findIndex(r=>r.key==="today/example.com");p.threadTree.selectedIndex=i;return true;')
   summary(2)
   js('p.commandController.doCommand("cmd_moveMessage",p.gFolder.parent.getChildNamed("Destination"));return true;')
   wait('return p.gFolder.getTotalMessages(false)===3 && p.gFolder.parent.getChildNamed("Destination").getTotalMessages(false)===2;')
   js('const top=Services.wm.getMostRecentWindow("mail:3pane");top.messenger.undo(top.msgWindow);return true;')
   wait('return p.gFolder.getTotalMessages(false)===5;')
   wait('return p.__nativeDateDomainState.model.roots.reduce((n,r)=>n+r.count,0)===5;')
   # Archive the group using the native summary button and transaction history.
   js('const i=p.__nativeDateDomainState.model.rows.findIndex(r=>r.key==="today/example.com");p.threadTree.selectedIndex=i;return true;')
   summary(2)
   js('p.multiMessageBrowser.contentDocument.getElementById("hdrArchiveButton").addEventListener("click",()=>p.__archiveClicked=true,true);return true;')
   click('#hdrArchiveButton',summary=True)
   wait('return p.gFolder.getTotalMessages(false)===3 && p.gFolder.parent.getChildNamed("Archives").getTotalMessages(false)===2;')
   js('const top=Services.wm.getMostRecentWindow("mail:3pane");top.messenger.undo(top.msgWindow);return true;')
   wait('return p.gFolder.getTotalMessages(false)===5;')
   wait('return p.__nativeDateDomainState.model.roots.reduce((n,r)=>n+r.count,0)===5;')
   # New arrivals update the selected date summary and order sources by newest message.
   js('p.threadTree.selectedIndex=0;return true;');summary(4)
   js("const f=p.gFolder.QueryInterface(Ci.nsIMsgLocalMailFolder),d=new Date();f.addMessage(['From: news@zzz.com','To: test@localhost','Subject: Incoming fixture','Date: '+d.toUTCString(),'Message-ID: <incoming@localhost>','Content-Type: text/plain','','New body','',''].join(String.fromCharCode(13,10)));return true;")
   wait('return p.gDBView.numSelected===5 && p.__nativeDateDomainState.model.roots[0].children[0].label==="zzz.com";')
   assert js('return p.__nativeDateDomainState.model.collapsed.has("today/zzz.com");')
   wait('return [...p.threadTree.querySelectorAll("tr.selected")].map(row=>row.index).join(",")=="0";')
   # Native quick filter changes the backing search view, and the adapter follows its scope.
   js('p.quickFilterBar.filterer.setFilterValue("text",{text:"Fixture message 2",states:{sender:false,recipients:false,subject:true,body:false}});p.quickFilterBar.updateSearch();return true;')
   wait('return p.__nativeDateDomainState?.proxy===p.gDBView && p.gDBView.numMsgsInView===1;')
   js('p.threadTree.selectedIndex=0;return true;');summary(1)
   assert js('return p.gDBView.getSelectedMsgHdrs()[0].messageId;')=='fixture-2@localhost'
   js('p.quickFilterBar.filterer.setFilterValue("text",{text:null,states:{sender:false,recipients:false,subject:true,body:false}});p.quickFilterBar.updateSearch();return true;')
   wait('return p.__nativeDateDomainState?.proxy===p.gDBView && p.gDBView.numMsgsInView===6;')
   js('p.quickFilterBar.filterer.setFilterValue("text",{text:"NO_MATCH_EXPECTED_049",states:{sender:false,recipients:false,subject:true,body:false}});p.quickFilterBar.updateSearch();return true;')
   wait('return p.__nativeDateDomainState?.proxy===p.gDBView && p.gDBView.numMsgsInView===0 && p.gDBView.rowCount===0;')
   assert js('return p.gDBView.numSelected;')==0
   js('p.quickFilterBar.filterer.setFilterValue("text",{text:null,states:{sender:false,recipients:false,subject:true,body:false}});p.quickFilterBar.updateSearch();return true;')
   wait('return p.__nativeDateDomainState?.proxy===p.gDBView && p.gDBView.numMsgsInView===6;')
   source_uri=js('return p.gFolder.URI;')
   # A unified unread saved search spans two real folders, including colliding message keys.
   js("const {MailServices}=ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');const {VirtualFolderHelper}=ChromeUtils.importESModule('resource:///modules/VirtualFolderWrapper.sys.mjs');const root=p.gFolder.parent;root.createSubfolder('Second Source',null);const second=root.getChildNamed('Second Source');const d=new Date();second.QueryInterface(Ci.nsIMsgLocalMailFolder).addMessage(['From: extra@example.com','To: test@localhost','Subject: Second folder fixture','Date: '+d.toUTCString(),'Message-ID: <second@localhost>','Content-Type: text/plain','','Second body','',''].join(String.fromCharCode(13,10)));p.gFolder.markMessagesRead([...p.gFolder.messages],false);const session=Cc['@mozilla.org/messenger/searchSession;1'].createInstance(Ci.nsIMsgSearchSession),term=session.createTerm(),value=term.value;term.attrib=Ci.nsMsgSearchAttrib.MsgStatus;value.attrib=Ci.nsMsgSearchAttrib.MsgStatus;value.status=Ci.nsMsgMessageFlags.Read;term.value=value;term.op=Ci.nsMsgSearchOp.Isnt;term.booleanAnd=true;const virtual=VirtualFolderHelper.createNewVirtualFolder('All Unread Fixture',root,[p.gFolder,second],[term],false);p.displayFolder(virtual.virtualFolder.URI);return true;")
   wait('return p.gFolder.name==="All Unread Fixture" && p.dbViewWrapperListener.allMessagesLoaded && p.gDBView.numMsgsInView===7;')
   js('p.document.querySelector("[data-native-sort-field=nativeDomainCol]").doCommand();return true;')
   wait('return p.__nativeDateDomainState?.proxy===p.gDBView;')
   js('if(!p.__nativeDateDomainState.config.keys.includes("nativeDomainCol"))p.document.querySelector("[data-native-sort-field=nativeDomainCol]").doCommand();if(!p.__nativeDateDomainState.config.grouped)p.document.querySelector("[value=groupedBySort]").doCommand();return true;')
   click('#threadTree-row0 .subject');summary(6)
   click('#threadTree-row0 .twisty')
   wait('return p.__nativeDateDomainState.model.rows.some(r=>r.key==="today/example.com");')
   js('p.threadTree.selectedIndex=p.__nativeDateDomainState.model.rows.findIndex(r=>r.key==="today/example.com");return true;');summary(3)
   assert js('return new Set(p.gDBView.getURIsForSelection()).size;')==3
   js('p.commandController.doCommand("cmd_markAsRead");return true;')
   wait('return p.gDBView.getSelectedMsgHdrs().length===3 && p.gDBView.getSelectedMsgHdrs().every(m=>m.isRead);')
   # Thunderbird's saved-search backend can retain newly read hits until its native refresh.
   js('p.gViewWrapper.refresh();return true;')
   wait('return p.__nativeDateDomainState?.proxy===p.gDBView && p.gDBView.numMsgsInView===4 && p.__nativeDateDomainState.model.roots.reduce((n,r)=>n+r.count,0)===4;')
   client.js('const p='+P+';p.displayFolder(arguments[0]);return true;',[source_uri])
   wait('return p.gFolder.name==="Native Fixture" && p.__nativeDateDomainState?.proxy===p.gDBView && p.gDBView.numMsgsInView===6;')
   # Native table view uses the same selection bridge.
   js('Services.prefs.setIntPref("mail.threadpane.listview",1);p.threadPane.updateThreadView();return true;')
   wait('return !!p.threadTree.querySelector("tr[is=thread-row]");')
   js('Services.prefs.setIntPref("mail.threadpane.listview",0);p.threadPane.updateThreadView();return true;')
   # A normal native column click now selects that field, not a separate view mode.
   js('p.sortController.sortThreadPane("dateCol");return true;')
   assert js('return p.__nativeDateDomainState.config.keys.join(",");')=='dateCol'
   assert js('return p.gFolder.getTotalMessages(false);')==6
   # Native conversation mode stays native and does not silently reattach.
   js('p.sortController.sortThreaded();return true;')
   wait('return !p.__nativeDateDomainState && p.gViewWrapper.showThreaded;')
   threaded_flags=js('return p.gDBView.viewFlags;')
   js('p.document.querySelector("[data-native-sort-field=nativeDomainCol]").doCommand();return true;')
   wait('return p.__nativeDateDomainState?.proxy===p.gDBView;')
   client.js("return (async()=>{const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');const addon=await AddonManager.getAddonByID('native-date-domain-groups@local.invalid');await addon.disable();return true;})();")
   wait('return !p.__nativeDateDomainState;')
   assert js('return p.gFolder.getTotalMessages(false);')==6
   assert js('return p.gDBView.viewFlags;')==threaded_flags
   assert js('return p.threadPane._onSelect===p.__originalHandlers.select && p.dbViewWrapperListener.onMessagesRemoved===p.__originalHandlers.removed && p.commandController.isCommandEnabled===p.__originalHandlers.enabled && p.commandController.doCommand===p.__originalHandlers.command && p.sortController.handleCommand===p.__originalHandlers.sort;')
   assert js('return !p.document.querySelector("[data-native-sort-field]");')
   # Folder-specific choices survive disabling and re-enabling the extension.
   client.js("return (async()=>{const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');const addon=await AddonManager.getAddonByID('native-date-domain-groups@local.invalid');await addon.enable();return true;})();")
   wait('return p.__nativeDateDomainState?.proxy===p.gDBView;')
   assert config()['keys']==['dateCol','nativeDomainCol'] and not config()['grouped']
   assert js('return p.__nativeDateDomainState.model.rows.every(r=>!r.children);')
   feedback(['byDate','byNativeDomain'],False)
   client.js("return (async()=>{const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');const addon=await AddonManager.getAddonByID('native-date-domain-groups@local.invalid');await addon.disable();return true;})();")
   wait('return !p.__nativeDateDomainState;')
   assert js('return p.document.getElementById("threadPaneSortByDateMenuitem").getAttribute("type");')=='radio'
   assert not js('return [...p.document.querySelectorAll("menuitem")].some(i=>/^\\d+ · /.test(i.getAttribute("label")||""));')
   errors=js('return Services.console.getMessageArray().filter(m=>/TypeError|ReferenceError|尚未适配|邮件已变化/.test(m.message)).map(m=>m.message);')
   assert not errors,errors
   print('PASS: numbered ordered multi-select; independent grouping checkbox; menu feedback/reopen; all 16 sort fields and nesting; persisted per-folder preferences; native pointer/header summaries, twisties and keyboard; overlap selection; native read/star/tag/spam; summary delete and undo; move/archive and undo; incoming mail; quick filter; unified unread; card/table; sort exit and disable cleanup.')
  except Exception:
   try:
    shot=client.send('WebDriver:TakeScreenshot',{'id':None,'highlights':[],'full':False,'scroll':False})['value'];(root/'failure-native.png').write_bytes(base64.b64decode(shot))
   except Exception:pass
   try:
    result=js('return {rows:p.gDBView?.rowCount,selection:p.gDBView?.getSelectedMsgHdrs().map(m=>m.messageId),archiveClicked:p.__archiveClicked,archiveEnabled:p.commandController.isCommandEnabled("cmd_archive"),commands:p.__commands,clicked:p.__deleteClicked,enabled:p.commandController.isCommandEnabled("cmd_delete"),native:p.__nativeDateDomainState?.raw.getSelectedMsgHdrs().map(m=>({id:m.messageId,read:m.isRead,folder:m.folder.name})),rawCount:p.__nativeDateDomainState?.raw.numMsgsInView,type:p.__nativeDateDomainState?.raw.viewType,terms:p.gViewWrapper.search.prettyString(),searchString:p.gFolder.msgDatabase.dBFolderInfo.getCharProperty("searchStr"),active:p.document.activeElement.id,summary:p.multiMessageBrowser.contentDocument.body.textContent.slice(0,500),model:p.__nativeDateDomainState?.model.rows.map(r=>({key:r.key,level:r.level}))};');print(json.dumps(result,ensure_ascii=False))
   except Exception:pass
   print('\n'.join(line for line in (profile/'process.log').read_text().splitlines() if any(word in line for word in ['Error:', 'Native Date', 'implementation.js']))[-3000:]);raise
  finally:
   process.terminate()
   try:process.wait(timeout=5)
   except subprocess.TimeoutExpired:process.kill();process.wait()
