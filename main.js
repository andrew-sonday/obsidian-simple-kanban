/*
 * Simple Kanban v2.0.0
 */
"use strict";
var obsidian=require("obsidian");
var DEFAULT_SETTINGS={defaultLayout:"fill",defaultFillCols:3,defaultMaxRows:0,fixedColumnWidth:320,fontScale:100,hideAddCardButton:false,showCheckboxes:false,hideToolbar:false,tagColors:{}};
var RE_TOP=/^[-*]\s(\[.\]\s)?(.*)$/;
var RE_SUB=/^(\t|\s{2,})[-*]\s(\[.\]\s)?(.*)$/;
var SK_COMMENT_RE=/\n?<!-- sk-config:(.*?) -->\s*$/;
var COL_COLORS=["","var(--sk-col-red)","var(--sk-col-green)","var(--sk-col-blue)","var(--sk-col-orange)","var(--sk-col-pink)","var(--sk-col-purple)","var(--sk-col-cyan)","var(--sk-col-yellow)","var(--sk-col-brown)"];
var COL_COLOR_NAMES=["None","Red","Green","Blue","Orange","Pink","Purple","Cyan","Yellow","Brown"];

function parseBoard(md){var cols=[],cc=null,ci=null,lines=md.split("\n");
  for(var i=0;i<lines.length;i++){var l=lines[i];
    if(l.match(/^## /)){cc={title:l.slice(3).trim(),items:[]};cols.push(cc);ci=null;continue}
    if(!cc)continue;var sm=l.match(RE_SUB);if(sm&&ci){ci.children.push({prefix:sm[2]||"",text:sm[3].trim(),children:[]});continue}
    var tm=l.match(RE_TOP);if(tm){ci={prefix:tm[1]||"",text:tm[2].trim(),children:[]};cc.items.push(ci);continue}
    if(l.trim()&&ci)ci.text+="\n"+l.trim();}return cols}

function serializeBoard(cols,fm){var md="";if(fm)md=fm+"\n\n";
  for(var i=0;i<cols.length;i++){if(i>0)md+="\n";md+="## "+cols[i].title+"\n";
    for(var j=0;j<cols[i].items.length;j++){var it=cols[i].items[j],ls=it.text.split("\n");
      md+="- "+(it.prefix||"")+ls[0]+"\n";for(var l=1;l<ls.length;l++)md+="\t"+ls[l]+"\n";
      for(var k=0;k<it.children.length;k++){var s=it.children[k],sl=s.text.split("\n");
        md+="\t- "+(s.prefix||"")+sl[0]+"\n";for(var x=1;x<sl.length;x++)md+="\t\t"+sl[x]+"\n";}}}return md}

function splitFM(c){var m=c.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);if(m)return{fm:m[0].trimEnd(),body:c.slice(m[0].length),raw:m[1]};return{fm:null,body:c,raw:null}}
function deepCopy(o){return JSON.parse(JSON.stringify(o))}

// Read/write hidden comment at end of file
function readPageConfig(content){var m=content.match(SK_COMMENT_RE);if(m){try{return JSON.parse(m[1])}catch(e){}}return null}
function writePageConfig(content,cfg){var json=JSON.stringify(cfg);var cleaned=content.replace(SK_COMMENT_RE,"").replace(/\s+$/,"");return cleaned+"\n\n\n\n\n\n\n<!-- sk-config:"+json+" -->"}

function showUndoToast(el,text,fn,dur){dur=dur||8000;var ex=el.querySelector(".sk-toast");if(ex)ex.remove();
  var t=document.createElement("div");t.className="sk-toast";var msg=document.createElement("span");msg.textContent=text;msg.className="sk-toast-msg";
  var btn=document.createElement("button");btn.textContent="Undo";btn.className="sk-toast-btn";t.appendChild(msg);t.appendChild(btn);el.appendChild(t);
  var tm=setTimeout(function(){t.remove()},dur);btn.addEventListener("click",function(){clearTimeout(tm);t.remove();fn()})}

class SettingsTab extends obsidian.PluginSettingTab{
  constructor(a,p){super(a,p);this.plugin=p}
  display(){var el=this.containerEl,p=this.plugin;el.empty();el.createEl("h2",{text:"Simple Kanban"});
    new obsidian.Setting(el).setName("Default layout").addDropdown(function(d){d.addOption("fill","Fill");d.addOption("fixed","Fixed");d.setValue(p.settings.defaultLayout);d.onChange(async function(v){p.settings.defaultLayout=v;await p.saveSettings()})});
    new obsidian.Setting(el).setName("Fill: columns per row").addSlider(function(s){s.setLimits(2,6,1);s.setValue(p.settings.defaultFillCols);s.setDynamicTooltip();s.onChange(async function(v){p.settings.defaultFillCols=v;await p.saveSettings()})});
    new obsidian.Setting(el).setName("Fill: max rows").setDesc("0=auto").addDropdown(function(d){d.addOption("0","Auto");for(var i=1;i<=4;i++)d.addOption(String(i),String(i));d.setValue(String(p.settings.defaultMaxRows));d.onChange(async function(v){p.settings.defaultMaxRows=parseInt(v);await p.saveSettings()})});
    new obsidian.Setting(el).setName("Fixed: column width").addSlider(function(s){s.setLimits(200,500,10);s.setValue(p.settings.fixedColumnWidth);s.setDynamicTooltip();s.onChange(async function(v){p.settings.fixedColumnWidth=v;await p.saveSettings()})});
    new obsidian.Setting(el).setName("Font size (%)").addSlider(function(s){s.setLimits(50,150,5);s.setValue(p.settings.fontScale);s.setDynamicTooltip();s.onChange(async function(v){p.settings.fontScale=v;await p.saveSettings()})});
    new obsidian.Setting(el).setName("Hide add card button").addToggle(function(t){t.setValue(p.settings.hideAddCardButton);t.onChange(async function(v){p.settings.hideAddCardButton=v;await p.saveSettings()})});
    new obsidian.Setting(el).setName("Show checkboxes (default)").addToggle(function(t){t.setValue(p.settings.showCheckboxes);t.onChange(async function(v){p.settings.showCheckboxes=v;await p.saveSettings()})});
    new obsidian.Setting(el).setName("Hide toolbar by default").setDesc("Toolbar starts collapsed, click ⚙ to show").addToggle(function(t){t.setValue(p.settings.hideToolbar);t.onChange(async function(v){p.settings.hideToolbar=v;await p.saveSettings()})});
    // Tag colors
    el.createEl("h3",{text:"Tag Colors"});
    el.createEl("p",{text:"Add tags and assign background colors. Use tags like #tagname in card text.",cls:"setting-item-description"});
    var tagContainer=el.createDiv({cls:"sk-tag-settings"});
    var renderTags=function(){tagContainer.empty();
      var tags=p.settings.tagColors||{};
      for(var tag in tags){(function(t){
        var row=tagContainer.createDiv({cls:"sk-tag-row"});
        var lbl=row.createSpan({text:"#"+t,cls:"sk-tag-label"});lbl.style.background=tags[t];
        var colorIn=row.createEl("input",{type:"color",value:tags[t]||"#e0e0e0"});
        colorIn.addEventListener("change",async function(){p.settings.tagColors[t]=colorIn.value;await p.saveSettings()});
        var delBtn=row.createEl("button",{text:"\u00d7",cls:"sk-tag-del"});
        delBtn.addEventListener("click",async function(){delete p.settings.tagColors[t];await p.saveSettings();renderTags()});
      })(tag)}
      // Add new tag
      var addRow=tagContainer.createDiv({cls:"sk-tag-row"});
      var addIn=addRow.createEl("input",{type:"text",attr:{placeholder:"tag name (without #)"},cls:"sk-tag-input"});
      var addColor=addRow.createEl("input",{type:"color",value:"#a8d8ea"});
      var addBtn=addRow.createEl("button",{text:"+",cls:"sk-tag-add"});
      addBtn.addEventListener("click",async function(){var v=addIn.value.trim().replace(/^#/,"");if(v){p.settings.tagColors[v]=addColor.value;await p.saveSettings();renderTags()}});
    };renderTags();
}}

class KanbanRenderer{
  constructor(el,plugin,file){
    this.containerEl=el;this.plugin=plugin;this.file=file;this.columns=[];
    this.meta={layout:plugin.settings.defaultLayout,columns:plugin.settings.defaultFillCols,maxRows:plugin.settings.defaultMaxRows,showCb:plugin.settings.showCheckboxes};
    this.frontmatter=null;this.saveTimeout=null;this.isSaving=false;
    this.dragSrcColIdx=-1;this.dragSrcCardIdx=-1;this.dragSrcIsChild=false;this.dragSrcChildIdx=-1;
    this.dropIndicatorEl=null;this.dropTarget=null;this.dragColIdx=-1;this.colDropIndicatorEl=null;this.colDropIdx=-1;
    this.editingKey=null;this.enterPressed=false;this.hiddenCols=new Set();this.colColors={};
    this.toolbarVisible=!plugin.settings.hideToolbar;this.pageConfigLoaded=false;this.collapsedCards=new Set();this.allCollapsed=false;
  }

  async load(){
    var raw=await this.plugin.app.vault.read(this.file);
    // Read page config from hidden comment
    var cfg=readPageConfig(raw);
    if(cfg&&!this.pageConfigLoaded){
      if(cfg.hidden)this.hiddenCols=new Set(cfg.hidden);
      if(cfg.colColors)this.colColors=cfg.colColors;
      if(cfg.showCb!==undefined)this.meta.showCb=cfg.showCb;
      if(cfg.layout)this.meta.layout=cfg.layout;
      if(cfg.cols)this.meta.columns=cfg.cols;
      if(cfg.maxRows!==undefined)this.meta.maxRows=cfg.maxRows;
      if(cfg.fixedW)this.meta.fixedW=cfg.fixedW;
      this.pageConfigLoaded=true;
    }
    // Strip config comment before parsing
    var clean=raw.replace(SK_COMMENT_RE,"");
    var s=splitFM(clean);this.frontmatter=s.fm;this.columns=parseBoard(s.body);this.render()
  }
  async reload(){if(this.isSaving||this.editingKey)return;await this.load()}
  scheduleSave(){if(this.saveTimeout)clearTimeout(this.saveTimeout);this.saveTimeout=setTimeout(()=>this.save(),250)}
  async save(){
    this.isSaving=true;
    var md=serializeBoard(this.columns,this.frontmatter);
    // Append page config
    var cfg={hidden:Array.from(this.hiddenCols),colColors:this.colColors,showCb:this.meta.showCb,layout:this.meta.layout,cols:this.meta.columns,maxRows:this.meta.maxRows,fixedW:this.meta.fixedW||0};
    md=writePageConfig(md,cfg);
    await this.plugin.app.vault.modify(this.file,md);
    setTimeout(()=>{this.isSaving=false},300);
  }

  deleteItem(col,colIdx,cardIdx,isChild,parentIdx){
    var self=this,item=isChild?col.items[parentIdx].children[cardIdx]:col.items[cardIdx];
    var had=item&&item.text&&item.text.trim();var snap=had?deepCopy(this.columns):null;
    if(isChild)col.items[parentIdx].children.splice(cardIdx,1);else col.items.splice(cardIdx,1);
    this.scheduleSave();this.render();
    if(had&&snap)showUndoToast(this.containerEl,(isChild?"Subtask":"Task")+" deleted",function(){self.columns=snap;self.scheduleSave();self.render()})
  }

  render(){
    var self=this,prevEditKey=this.editingKey;
    var scrolls=[],oldA=this.containerEl.querySelectorAll(".sk-card-area");
    for(var i=0;i<oldA.length;i++)scrolls.push(oldA[i].scrollTop);
    var oldB=this.containerEl.querySelector(".sk-board");var bSL=oldB?oldB.scrollLeft:0;var bST=oldB?oldB.scrollTop:0;

    this.containerEl.empty();this.containerEl.addClass("sk-root");
    this.containerEl.style.fontSize="calc(var(--font-text-size) * "+(this.plugin.settings.fontScale/100)+")";

    // Toolbar
    if(this.toolbarVisible){
      var tb=this.containerEl.createDiv({cls:"sk-toolbar"});
      var hideBtn=tb.createEl("button",{text:"\u2715",cls:"sk-toolbar-close",attr:{title:"Hide"}});
      hideBtn.addEventListener("click",function(){self.toolbarVisible=false;self.render()});
      this.renderToolbar(tb);
    }

    var bw=this.containerEl.createDiv({cls:"sk-board-wrap"});
    if(!this.toolbarVisible){
      var sb=bw.createEl("button",{text:"\u2699",cls:"sk-settings-float",attr:{title:"Settings"}});
      sb.addEventListener("click",function(){self.toolbarVisible=true;self.render()});
    }

    var board=bw.createDiv({cls:"sk-board"});
    var isFill=this.meta.layout==="fill";board.addClass(isFill?"sk-layout-fill":"sk-layout-fixed");
    var total=this.columns.length,vis=[];
    for(var vi=0;vi<total;vi++)if(!this.hiddenCols.has(vi))vis.push(vi);
    var cpr=this.meta.columns,natR=Math.max(1,Math.ceil(vis.length/cpr)),mR=this.meta.maxRows;
    var nR=(mR>0&&mR<natR)?mR:natR;
    if(isFill&&mR>0&&natR>mR){board.style.overflowY="auto";board.style.alignContent="flex-start"}

    for(var ci=0;ci<total;ci++){if(this.hiddenCols.has(ci))continue;this.renderColumn(board,ci,prevEditKey,isFill,nR)}

    var nA=this.containerEl.querySelectorAll(".sk-card-area");
    for(var ri=0;ri<nA.length&&ri<scrolls.length;ri++)nA[ri].scrollTop=scrolls[ri];
    board.scrollLeft=bSL;board.scrollTop=bST;
  }

  renderToolbar(tb){
    var self=this;
    var fillB=tb.createEl("button",{text:"Fill",cls:"sk-toolbar-btn"});
    var fixB=tb.createEl("button",{text:"Fixed",cls:"sk-toolbar-btn"});
    if(this.meta.layout==="fill")fillB.addClass("sk-active");else fixB.addClass("sk-active");
    fillB.addEventListener("click",function(){self.meta.layout="fill";self.scheduleSave();self.render()});
    fixB.addEventListener("click",function(){self.meta.layout="fixed";self.scheduleSave();self.render()});

    if(this.meta.layout==="fixed"){
      tb.createDiv({cls:"sk-toolbar-sep"});
      var fwg=tb.createDiv({cls:"sk-cols-group"});
      fwg.createSpan({text:"Width:",cls:"sk-cols-label"});
      var fwInput=fwg.createEl("input",{type:"number",cls:"sk-width-input",value:String(this.meta.fixedW||this.plugin.settings.fixedColumnWidth),attr:{min:"150",max:"600",step:"10"}});
      fwInput.addEventListener("change",function(){var v=parseInt(fwInput.value);if(v>=150&&v<=600){self.meta.fixedW=v;self.scheduleSave();self.render()}});
    }

    if(this.meta.layout==="fill"){
      tb.createDiv({cls:"sk-toolbar-sep"});
      // Cols dropdown
      var cwrap=tb.createDiv({cls:"sk-hide-cols-wrap"});
      var cbtn=cwrap.createEl("button",{text:"Cols:"+this.meta.columns,cls:"sk-toolbar-btn"});
      var cdd=cwrap.createDiv({cls:"sk-hide-dropdown sk-mini-dropdown"});cdd.style.display="none";
      cbtn.addEventListener("click",function(e){e.stopPropagation();cdd.style.display=cdd.style.display==="none"?"block":"none"});
      document.addEventListener("click",function(e){if(!cwrap.contains(e.target))cdd.style.display="none"});
      for(var n=1;n<=6;n++){(function(num){var b=cdd.createDiv({cls:"sk-hide-row sk-mini-row"});b.textContent=String(num);
        if(self.meta.columns===num)b.addClass("sk-active-row");
        b.addEventListener("click",function(){self.meta.columns=num;self.scheduleSave();self.render()})})(n)}
      // Rows dropdown
      var rwrap=tb.createDiv({cls:"sk-hide-cols-wrap"});
      var rbtn=rwrap.createEl("button",{text:"Rows:"+(this.meta.maxRows||"\u221E"),cls:"sk-toolbar-btn"});
      var rdd=rwrap.createDiv({cls:"sk-hide-dropdown sk-mini-dropdown"});rdd.style.display="none";
      rbtn.addEventListener("click",function(e){e.stopPropagation();rdd.style.display=rdd.style.display==="none"?"block":"none"});
      document.addEventListener("click",function(e){if(!rwrap.contains(e.target))rdd.style.display="none"});
      [{v:0,l:"\u221E"},{v:1,l:"1"},{v:2,l:"2"},{v:3,l:"3"},{v:4,l:"4"}].forEach(function(o){
        var b=rdd.createDiv({cls:"sk-hide-row sk-mini-row"});b.textContent=o.l;
        if(self.meta.maxRows===o.v)b.addClass("sk-active-row");
        b.addEventListener("click",function(){self.meta.maxRows=o.v;self.scheduleSave();self.render()})});
    }

    tb.createDiv({cls:"sk-toolbar-sep"});
    // Show checkboxes toggle — small
    var cbBtn=tb.createEl("button",{text:this.meta.showCb?"\u2611":"\u2610",cls:"sk-cols-btn",attr:{title:"Toggle checkboxes"}});
    if(this.meta.showCb)cbBtn.addClass("sk-active");
    cbBtn.addEventListener("click",function(){self.meta.showCb=!self.meta.showCb;self.scheduleSave();self.render()});

    // Collapse all subtasks toggle
    var collapseBtn=tb.createEl("button",{text:this.allCollapsed?"\u25B6":"\u25BC",cls:"sk-cols-btn",attr:{title:this.allCollapsed?"Expand all subtasks":"Collapse all subtasks"}});
    collapseBtn.addEventListener("click",function(){
      self.allCollapsed=!self.allCollapsed;
      self.collapsedCards.clear();
      // If collapsing all, add all cards that have children
      if(self.allCollapsed){for(var ci2=0;ci2<self.columns.length;ci2++)for(var ii=0;ii<self.columns[ci2].items.length;ii++)if(self.columns[ci2].items[ii].children.length>0)self.collapsedCards.add(ci2+"-"+ii)}
      self.render()
    });

    tb.createDiv({cls:"sk-toolbar-sep"});
    // + Column in toolbar
    var addColBtn=tb.createEl("button",{text:"+ Column",cls:"sk-toolbar-btn"});
    addColBtn.addEventListener("click",function(){var ni=self.columns.length;delete self.colColors[ni];self.columns.push({title:"New Column",items:[]});self.scheduleSave();self.render()});

    tb.createDiv({cls:"sk-toolbar-sep"});
    // Columns dropdown
    var hw=tb.createDiv({cls:"sk-hide-cols-wrap"});
    var hb=hw.createEl("button",{text:"Columns \u25BE",cls:"sk-toolbar-btn"});
    var dd=hw.createDiv({cls:"sk-hide-dropdown"});dd.style.display="none";
    hb.addEventListener("click",function(e){e.stopPropagation();dd.style.display=dd.style.display==="none"?"block":"none"});
    var closeHandler=function(e){if(!hw.contains(e.target))dd.style.display="none"};
    document.addEventListener("click",closeHandler);

    for(var ci=0;ci<this.columns.length;ci++){(function(idx){
      var ct=self.columns[idx].title;
      var row=dd.createDiv({cls:"sk-hide-row"});
      var vcb=row.createEl("input",{type:"checkbox"});vcb.checked=!self.hiddenCols.has(idx);
      vcb.addEventListener("change",function(e){e.stopPropagation();
        if(vcb.checked)self.hiddenCols.delete(idx);else self.hiddenCols.add(idx);
        self.scheduleSave();
        // Update board without closing dropdown
        var board=self.containerEl.querySelector(".sk-board");
        if(board){var cols=board.querySelectorAll(".sk-column");
          // Re-render board only
          var bw=self.containerEl.querySelector(".sk-board-wrap");
          var oldB=bw.querySelector(".sk-board");var bSL2=oldB?oldB.scrollLeft:0;
          oldB.remove();var nb=bw.createDiv({cls:"sk-board"});
          var isFill2=self.meta.layout==="fill";nb.addClass(isFill2?"sk-layout-fill":"sk-layout-fixed");
          var total2=self.columns.length,vis2=[];for(var v=0;v<total2;v++)if(!self.hiddenCols.has(v))vis2.push(v);
          var cpr2=self.meta.columns,natR2=Math.max(1,Math.ceil(vis2.length/cpr2)),mR2=self.meta.maxRows;
          var nR2=(mR2>0&&mR2<natR2)?mR2:natR2;
          if(isFill2&&mR2>0&&natR2>mR2){nb.style.overflowY="auto";nb.style.alignContent="flex-start"}
          for(var c2=0;c2<total2;c2++){if(self.hiddenCols.has(c2))continue;self.renderColumn(nb,c2,null,isFill2,nR2)}
          nb.scrollLeft=bSL2;
          // Move add-column before board end
          var addC=bw.querySelector(".sk-add-column");if(addC)bw.appendChild(addC);
        }
      });
      row.createSpan({text:ct,cls:"sk-hide-row-title"});
      var colorSel=row.createEl("select",{cls:"sk-color-select"});
      for(var c=0;c<COL_COLORS.length;c++){var opt=colorSel.createEl("option",{text:COL_COLOR_NAMES[c],value:COL_COLORS[c]});if((self.colColors[idx]||"")===COL_COLORS[c])opt.selected=true}
      colorSel.addEventListener("change",function(e){e.stopPropagation();self.colColors[idx]=colorSel.value;self.scheduleSave();
        // Update column color in-place
        var allCols=self.containerEl.querySelectorAll(".sk-column");
        allCols.forEach(function(el){
          var cIdx=parseInt(el.dataset.colIdx);
          if(cIdx===idx)el.style.background=colorSel.value||""});
      });
    })(ci)}
  }

  renderColumn(board,colIdx,prevEditKey,isFill,numRows){
    var self=this,col=this.columns[colIdx],colEl=board.createDiv({cls:"sk-column"}),fixedW=this.meta.fixedW||this.plugin.settings.fixedColumnWidth;
    colEl.dataset.colIdx=String(colIdx);
    if(isFill){var pct=100/this.meta.columns;colEl.style.width="calc("+pct+"% - 8px)";colEl.style.minWidth="calc("+pct+"% - 8px)";colEl.style.maxWidth="calc("+pct+"% - 8px)";
      var rg=8,h="calc((100% - "+((numRows-1)*rg)+"px) / "+numRows+")";colEl.style.height=h;colEl.style.maxHeight=h;
    }else{colEl.style.width=fixedW+"px";colEl.style.minWidth=fixedW+"px"}
    // Column color
    var cc=this.colColors[colIdx];if(cc)colEl.style.background=cc;

    var header=colEl.createDiv({cls:"sk-column-header"});header.setAttribute("draggable","true");
    header.addEventListener("dragstart",function(e){self.dragColIdx=colIdx;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain","col");colEl.addClass("sk-col-dragging");self.containerEl.addClass("sk-dragging-active")});
    header.addEventListener("dragend",function(){colEl.removeClass("sk-col-dragging");self.dragColIdx=-1;self.clearColDropIndicator();self.containerEl.removeClass("sk-dragging-active")});
    colEl.addEventListener("dragover",function(e){if(self.dragColIdx>=0){e.preventDefault();e.dataTransfer.dropEffect="move";self.handleColDragOver(e,board,colIdx)}});
    colEl.addEventListener("drop",function(e){if(self.dragColIdx>=0){e.preventDefault();self.executeColDrop()}});
    this.renderColumnHeader(header,colIdx);

    // Column hover actions (top-right)
    var colActions=colEl.createDiv({cls:"sk-col-actions"});
    if(col.items.length===0){
      // Delete button for empty column
      var delColBtn=colActions.createEl("button",{text:"\u00d7",cls:"sk-col-action-btn sk-col-action-delete",attr:{title:"Delete column"}});
      delColBtn.addEventListener("click",function(e){e.stopPropagation();
        var snap=deepCopy(self.columns);var snapC=deepCopy(self.colColors);var snapH=new Set(self.hiddenCols);
        var nC={},nH=new Set();
        for(var k in self.colColors){var ki=parseInt(k);if(ki<colIdx)nC[ki]=self.colColors[k];else if(ki>colIdx)nC[ki-1]=self.colColors[k]}
        self.hiddenCols.forEach(function(idx){if(idx<colIdx)nH.add(idx);else if(idx>colIdx)nH.add(idx-1)});
        self.colColors=nC;self.hiddenCols=nH;
        self.columns.splice(colIdx,1);self.scheduleSave();self.render();
        showUndoToast(self.containerEl,"Column deleted",function(){self.columns=snap;self.colColors=snapC;self.hiddenCols=snapH;self.scheduleSave();self.render()})});
    } else {
      // Copy column as raw markdown
      var copyBtn=colActions.createEl("button",{text:"\u2398",cls:"sk-col-action-btn",attr:{title:"Copy column text"}});
      copyBtn.addEventListener("click",function(e){e.stopPropagation();
        var md="";
        for(var ti=0;ti<col.items.length;ti++){var it=col.items[ti],ls=it.text.split("\n");
          md+="- "+(it.prefix||"")+ls[0]+"\n";for(var li=1;li<ls.length;li++)md+="\t"+ls[li]+"\n";
          for(var si=0;si<it.children.length;si++){var s=it.children[si],sl2=s.text.split("\n");
            md+="\t- "+(s.prefix||"")+sl2[0]+"\n";for(var x=1;x<sl2.length;x++)md+="\t\t"+sl2[x]+"\n"}}
        navigator.clipboard.writeText(md);new obsidian.Notice("Column copied")});
      // Collapse/expand all subtasks in this column
      var colCollapseBtn=colActions.createEl("button",{text:"\u25BC",cls:"sk-col-action-btn",attr:{title:"Toggle subtasks in column"}});
      colCollapseBtn.addEventListener("click",function(e){e.stopPropagation();
        var hasExpanded=false;
        for(var ti=0;ti<col.items.length;ti++){if(col.items[ti].children.length>0&&!self.collapsedCards.has(colIdx+"-"+ti)){hasExpanded=true;break}}
        for(var ti2=0;ti2<col.items.length;ti2++){if(col.items[ti2].children.length>0){var ck=colIdx+"-"+ti2;if(hasExpanded)self.collapsedCards.add(ck);else self.collapsedCards.delete(ck)}}
        self.render()});
    }

    var ca=colEl.createDiv({cls:"sk-card-area"});
    // Double click on empty area adds task
    ca.addEventListener("dblclick",function(e){if(e.target===ca||e.target.classList.contains("sk-add-card")){
      col.items.push({prefix:"",text:"",children:[]});self.editingKey=colIdx+"-"+(col.items.length-1);self.scheduleSave();self.render()}});
    ca.addEventListener("dragover",function(e){if(self.dragColIdx>=0)return;e.preventDefault();e.dataTransfer.dropEffect="move";self.handleDragOver(e,ca,colIdx)});
    ca.addEventListener("dragleave",function(e){if(!ca.contains(e.relatedTarget))self.clearDropIndicator()});
    ca.addEventListener("drop",function(e){if(self.dragColIdx>=0)return;e.preventDefault();self.executeDrop()});
    for(var ci=0;ci<col.items.length;ci++)this.renderCard(ca,colIdx,ci,false,-1,prevEditKey);
    if(!this.plugin.settings.hideAddCardButton||col.items.length===0){
      var ab=ca.createEl("button",{text:"+ Add card",cls:"sk-add-card"});
      ab.addEventListener("click",function(){col.items.push({prefix:"",text:"",children:[]});self.editingKey=colIdx+"-"+(col.items.length-1);self.scheduleSave();self.render()})}
  }

  renderColumnHeader(header,colIdx){
    var self=this,col=this.columns[colIdx];
    var left=header.createDiv({cls:"sk-col-header-left"});
    var title=left.createSpan({cls:"sk-column-title"});title.textContent=col.title;
    left.createSpan({cls:"sk-column-count",text:String(col.items.length)});
    header.createDiv({cls:"sk-col-grip"}).innerHTML="&#8942;&#8942;";
    title.addEventListener("click",function(e){e.stopPropagation();header.empty();
      var input=header.createEl("input",{cls:"sk-column-title-input",value:col.title});input.focus();input.select();
      var done=function(){var v=input.value.trim();if(v&&v!==col.title){col.title=v;self.scheduleSave()}self.render()};
      input.addEventListener("blur",done);input.addEventListener("keydown",function(e2){if(e2.key==="Enter")input.blur();if(e2.key==="Escape"){input.value=col.title;input.blur()}})});
  }

  renderCard(container,colIdx,cardIdx,isChild,parentIdx,prevEditKey){
    var self=this,col=this.columns[colIdx],item=isChild?col.items[parentIdx].children[cardIdx]:col.items[cardIdx];
    var editKey=isChild?colIdx+"-"+parentIdx+"-"+cardIdx:colIdx+"-"+cardIdx;
    var card=container.createDiv({cls:"sk-card"+(isChild?" sk-card-child":"")});
    if(prevEditKey&&prevEditKey===editKey){this.buildEditor(card,colIdx,cardIdx,isChild,parentIdx,editKey);return}
    card.setAttribute("draggable","true");
    var content=card.createDiv({cls:"sk-card-content"});
    var showCb=this.meta.showCb&&item.prefix;
    if(showCb){var cbM=item.prefix.match(/^\[(.)\]\s?$/);if(cbM){var cbC=cbM[1];
      var cb=content.createEl("input",{type:"checkbox",cls:"sk-checkbox task-list-item-checkbox",attr:{"data-task":cbC}});
      cb.checked=cbC!==" ";if(cbC!==" "&&cbC!=="x")cb.dataset.task=cbC;
      cb.addEventListener("click",function(e){e.stopPropagation();if(cb.checked){item.prefix="[x] ";cb.dataset.task="x"}else{item.prefix="[ ] ";cb.dataset.task=" "}self.scheduleSave()})}}
    var te=content.createDiv({cls:"sk-card-text"});
    if(!item.text){te.textContent="(empty)";te.addClass("sk-empty-text")}
    else{obsidian.MarkdownRenderer.render(self.plugin.app,item.text,te,self.file?self.file.path:"",self.plugin);
      te.querySelectorAll("a.internal-link").forEach(function(link){link.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();var href=link.getAttribute("href");if(href)self.plugin.app.workspace.openLinkText(href,self.file?self.file.path:"")})});
      // Color tags
      var tc=self.plugin.settings.tagColors||{};
      te.querySelectorAll("a.tag").forEach(function(tagEl){var tn=tagEl.textContent.replace(/^#/,"");if(tc[tn])tagEl.style.background=tc[tn]});
    }
    var actions=card.createDiv({cls:"sk-card-actions"});
    if(!isChild){
      var at=actions.createEl("button",{text:"\u2795",cls:"sk-card-action-btn sk-add-task-btn",attr:{title:"Add task"}});
      at.addEventListener("click",function(e){e.stopPropagation();var np="";if(item.prefix&&item.prefix.match(/^\[.\]\s?$/))np="[ ] ";
        col.items.splice(cardIdx+1,0,{prefix:np,text:"",children:[]});self.editingKey=colIdx+"-"+(cardIdx+1);self.scheduleSave();self.render()});
      var as=actions.createEl("button",{text:"\u2937",cls:"sk-card-action-btn sk-add-subtask-btn",attr:{title:"Add subtask"}});
      as.addEventListener("click",function(e){e.stopPropagation();item.children.push({prefix:"",text:"",children:[]});self.editingKey=colIdx+"-"+cardIdx+"-"+(item.children.length-1);self.scheduleSave();self.render()});
    }
    var db=actions.createEl("button",{text:"\u00d7",cls:"sk-card-action-btn sk-card-delete-btn",attr:{title:"Delete"}});
    db.addEventListener("click",function(e){e.stopPropagation();self.deleteItem(col,colIdx,cardIdx,isChild,parentIdx)});
    card.addEventListener("dragstart",function(e){e.stopPropagation();self.dragSrcColIdx=colIdx;
      if(isChild){self.dragSrcIsChild=true;self.dragSrcCardIdx=parentIdx;self.dragSrcChildIdx=cardIdx}
      else{self.dragSrcIsChild=false;self.dragSrcCardIdx=cardIdx;self.dragSrcChildIdx=-1}
      card.addClass("sk-dragging");self.containerEl.addClass("sk-dragging-active");e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain","card")});
    card.addEventListener("dragend",function(){card.removeClass("sk-dragging");self.clearDropIndicator();self.dragSrcColIdx=-1;self.containerEl.removeClass("sk-dragging-active")});
    card.addEventListener("click",function(e){
      if(e.target.closest(".sk-card-actions"))return;if(e.target.closest(".sk-checkbox"))return;if(e.target.closest("a"))return;if(e.target.closest(".sk-collapse-toggle"))return;
      if(!isChild&&e.target.closest(".sk-card-child"))return;if(!isChild&&e.target.closest(".sk-subtasks"))return;
      var sel=window.getSelection();if(sel&&sel.toString().length>0)return;self.editingKey=editKey;self.render()});
    if(!isChild&&item.children&&item.children.length>0){
      var collapseKey=colIdx+"-"+cardIdx;
      var isCollapsed=self.collapsedCards.has(collapseKey);
      card.addClass("sk-has-subtasks");
      // Collapse toggle on left edge
      var toggleBtn=card.createDiv({cls:"sk-collapse-toggle"+(isCollapsed?" sk-collapsed":"")});
      toggleBtn.textContent=isCollapsed?"\u25B8":"\u25BE";
      toggleBtn.addEventListener("click",function(e){e.stopPropagation();
        if(self.collapsedCards.has(collapseKey))self.collapsedCards.delete(collapseKey);
        else self.collapsedCards.add(collapseKey);
        self.render()});
      if(!isCollapsed){
        var subs=card.createDiv({cls:"sk-subtasks"});
        for(var ci=0;ci<item.children.length;ci++)this.renderCard(subs,colIdx,ci,true,cardIdx,prevEditKey);
        subs.addEventListener("dragover",function(e){if(self.dragSrcIsChild&&self.dragSrcCardIdx===cardIdx&&self.dragSrcColIdx===colIdx){
          e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect="move";
          var sc=subs.querySelectorAll(":scope > .sk-card-child"),my=e.clientY,idx=item.children.length;
          for(var si=0;si<sc.length;si++){var r=sc[si].getBoundingClientRect();if(my<r.top+r.height/2){idx=si;break}}
          self.clearDropIndicator();if(idx!==self.dragSrcChildIdx&&idx!==self.dragSrcChildIdx+1){
            var ind=document.createElement("div");ind.className="sk-drop-indicator";
            if(idx<sc.length)sc[idx].before(ind);else subs.appendChild(ind);
            self.dropIndicatorEl=ind;self.dropTarget={colIdx:colIdx,cardIdx:cardIdx,asChild:false,subReorder:true,subIdx:idx}}}});
        subs.addEventListener("drop",function(e){if(self.dropTarget&&self.dropTarget.subReorder){e.preventDefault();e.stopPropagation();self.clearDropIndicator();
          var from=self.dragSrcChildIdx,to=self.dropTarget.subIdx;
          if(from!==to&&from!==to-1){var moved=item.children.splice(from,1)[0];item.children.splice(to>from?to-1:to,0,moved);self.scheduleSave();self.render()}self.dropTarget=null}});
      }
    } else if(!isChild&&item.children&&item.children.length===0){
      // No indicator needed
    }
  }

  buildEditor(card,colIdx,cardIdx,isChild,parentIdx,editKey){
    var self=this,col=this.columns[colIdx],item=isChild?col.items[parentIdx].children[cardIdx]:col.items[cardIdx];
    var showCb=this.meta.showCb;card.setAttribute("draggable","false");card.addClass("sk-editing");
    var ta=card.createEl("textarea",{cls:"sk-card-input"});
    ta.value=(showCb&&item.prefix)?item.prefix+item.text:item.text;
    ta.setAttribute("placeholder",isChild?"Subtask...":"Task...");
    setTimeout(function(){ta.focus();ta.selectionStart=ta.selectionEnd=ta.value.length},0);
    var resize=function(){ta.style.height="auto";ta.style.height=ta.scrollHeight+"px"};setTimeout(resize,0);
    var splitPT=function(v){if(showCb){var m=v.match(/^(\[.\]\s?)([\s\S]*)$/);if(m)return{prefix:m[1].endsWith(" ")?m[1]:m[1]+" ",text:m[2]};return{prefix:"",text:v}}return{prefix:item.prefix,text:v}};
    ta.addEventListener("input",function(){resize();var p=splitPT(ta.value);item.prefix=p.prefix;item.text=p.text;self.scheduleSave();
      // Tag autocomplete
      var cur=ta.selectionStart,val=ta.value,before=val.slice(0,cur);
      var hashM=before.match(/#([\w\-]*)$/);
      var popup=self.containerEl.querySelector(".sk-tag-popup");if(popup)popup.remove();
      if(hashM){
        var partial=hashM[1].toLowerCase(),allTags=Object.keys(self.plugin.app.metadataCache.getTags()||{}).map(function(t){return t.replace(/^#/,"")});
        var stags=Object.keys(self.plugin.settings.tagColors||{});
        stags.forEach(function(st){if(allTags.indexOf(st)<0)allTags.push(st)});
        var filtered=allTags.filter(function(t){return t.toLowerCase().startsWith(partial)}).slice(0,8);
        if(filtered.length>0){
          popup=document.createElement("div");popup.className="sk-tag-popup";
          self.containerEl.appendChild(popup);
          // Position near textarea
          var taRect=ta.getBoundingClientRect();var rootRect=self.containerEl.getBoundingClientRect();
          var spaceAbove=taRect.top-rootRect.top;var spaceBelow=rootRect.bottom-taRect.bottom;
          popup.style.left=(taRect.left-rootRect.left)+"px";
          if(spaceAbove>spaceBelow){popup.style.bottom=(rootRect.bottom-taRect.top+4)+"px";popup.style.top="auto"}
          else{popup.style.top=(taRect.bottom-rootRect.top+4)+"px";popup.style.bottom="auto"}
          filtered.forEach(function(tag){
            var opt=popup.createDiv({cls:"sk-tag-option"});opt.textContent="#"+tag;
            var tc=self.plugin.settings.tagColors;if(tc&&tc[tag])opt.style.background=tc[tag];
            opt.addEventListener("mousedown",function(e){e.preventDefault();
              var newVal=val.slice(0,cur-hashM[0].length)+"#"+tag+val.slice(cur);
              ta.value=newVal;ta.selectionStart=ta.selectionEnd=cur-hashM[0].length+tag.length+1;
              var p2=splitPT(ta.value);item.prefix=p2.prefix;item.text=p2.text;self.scheduleSave();
              var pp=self.containerEl.querySelector(".sk-tag-popup");if(pp)pp.remove()})})}}});
    ta.addEventListener("blur",function(){var pp=self.containerEl.querySelector(".sk-tag-popup");if(pp)pp.remove();
      if(self.enterPressed){self.enterPressed=false;return}self.editingKey=null;
      var p=splitPT(ta.value);item.prefix=p.prefix;item.text=p.text;
      if(!item.text.trim()){self.deleteItem(col,colIdx,cardIdx,isChild,parentIdx);return}self.render()});
    ta.addEventListener("keydown",function(e){
      if(e.key==="Escape"){self.editingKey=null;ta.blur();return}
      if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();var p=splitPT(ta.value);item.prefix=p.prefix;item.text=p.text;self.scheduleSave();
        if(!item.text.trim()){self.editingKey=null;ta.blur();return}
        var np="";if(item.prefix&&item.prefix.match(/^\[.\]\s?$/))np="[ ] ";
        if(isChild){col.items[parentIdx].children.splice(cardIdx+1,0,{prefix:np,text:"",children:[]});self.editingKey=colIdx+"-"+parentIdx+"-"+(cardIdx+1)}
        else{col.items.splice(cardIdx+1,0,{prefix:np,text:"",children:[]});self.editingKey=colIdx+"-"+(cardIdx+1)}
        self.enterPressed=true;self.scheduleSave();self.render()}});
  }

  handleDragOver(e,ca,ci){var col=this.columns[ci],cards=ca.querySelectorAll(":scope > .sk-card"),mx=e.clientX,my=e.clientY,idx=col.items.length,ac=false;
    // Check each card - right 40% = asChild, top half = insert before, bottom half = insert after
    for(var i=0;i<cards.length;i++){var r=cards[i].getBoundingClientRect();
      if(my>=r.top&&my<=r.bottom){if(mx>r.left+r.width*0.6){idx=i;ac=true}else if(my<r.top+r.height/2){idx=i}else{idx=i+1}break}
      if(my<r.top){idx=i;break}}
    // Block dropping card onto itself as sibling (no-op move)
    if(!this.dragSrcIsChild&&this.dragSrcColIdx===ci&&!ac&&(idx===this.dragSrcCardIdx||idx===this.dragSrcCardIdx+1)){this.clearDropIndicator();this.dropTarget=null;return}
    // Block dropping card as child of itself
    if(!this.dragSrcIsChild&&this.dragSrcColIdx===ci&&ac&&idx===this.dragSrcCardIdx){this.clearDropIndicator();this.dropTarget=null;return}
    this.dropTarget={colIdx:ci,cardIdx:idx,asChild:ac};this.clearDropIndicator();
    if(ac&&idx<cards.length)cards[idx].addClass("sk-drop-as-child");
    else{var ind=document.createElement("div");ind.className="sk-drop-indicator";if(idx<cards.length)cards[idx].before(ind);else{var ab=ca.querySelector(".sk-add-card");if(ab)ab.before(ind);else ca.appendChild(ind)}this.dropIndicatorEl=ind}}
  clearDropIndicator(){if(this.dropIndicatorEl){this.dropIndicatorEl.remove();this.dropIndicatorEl=null}var hl=this.containerEl.querySelectorAll(".sk-drop-as-child");for(var i=0;i<hl.length;i++)hl[i].removeClass("sk-drop-as-child")}
  executeDrop(){this.clearDropIndicator();if(this.dragSrcColIdx<0||!this.dropTarget)return;if(this.dropTarget.subReorder)return;
    var d=this.dropTarget,sc=this.columns[this.dragSrcColIdx],dc=this.columns[d.colIdx],di;
    if(this.dragSrcIsChild)di=sc.items[this.dragSrcCardIdx].children.splice(this.dragSrcChildIdx,1)[0];else di=sc.items.splice(this.dragSrcCardIdx,1)[0];if(!di)return;
    if(d.asChild){var t=d.cardIdx;if(!this.dragSrcIsChild&&this.dragSrcColIdx===d.colIdx&&this.dragSrcCardIdx<d.cardIdx)t--;if(t>=0&&t<dc.items.length)dc.items[t].children.push(di);else if(dc.items.length>0)dc.items[dc.items.length-1].children.push(di);else dc.items.push(di)}
    else{var ins=d.cardIdx;if(!this.dragSrcIsChild&&this.dragSrcColIdx===d.colIdx&&this.dragSrcCardIdx<d.cardIdx)ins=Math.max(0,ins-1);if(ins>dc.items.length)ins=dc.items.length;dc.items.splice(ins,0,di)}
    this.dropTarget=null;this.scheduleSave();this.render()}
  handleColDragOver(e,board,oci){if(this.dragColIdx===oci){this.clearColDropIndicator();return}this.clearColDropIndicator();
    var cols=board.querySelectorAll(":scope > .sk-column");if(oci>=cols.length)return;
    var r=cols[oci].getBoundingClientRect(),isL=e.clientX<r.left+r.width/2;
    var ind=document.createElement("div");ind.className="sk-col-drop-indicator";
    if(isL){cols[oci].before(ind);this.colDropIdx=oci}else{cols[oci].after(ind);this.colDropIdx=oci+1}this.colDropIndicatorEl=ind}
  clearColDropIndicator(){if(this.colDropIndicatorEl){this.colDropIndicatorEl.remove();this.colDropIndicatorEl=null}}
  executeColDrop(){this.clearColDropIndicator();if(this.dragColIdx<0||this.colDropIdx<0)return;
    var f=this.dragColIdx,t=this.colDropIdx;if(f===t||f===t-1){this.dragColIdx=-1;return}
    var nH=new Set(),nT=t>f?t-1:t;
    this.hiddenCols.forEach(function(idx){var ni=idx;if(idx===f)ni=nT;else{if(f<nT){if(idx>f&&idx<=nT)ni=idx-1}else{if(idx>=nT&&idx<f)ni=idx+1}}nH.add(ni)});
    // Remap colors
    var nC={};for(var k in this.colColors){var ki=parseInt(k),ni2=ki;if(ki===f)ni2=nT;else{if(f<nT){if(ki>f&&ki<=nT)ni2=ki-1}else{if(ki>=nT&&ki<f)ni2=ki+1}}if(this.colColors[k])nC[ni2]=this.colColors[k]}
    this.hiddenCols=nH;this.colColors=nC;
    var c=this.columns.splice(f,1)[0];this.columns.splice(nT,0,c);
    this.dragColIdx=-1;this.colDropIdx=-1;this.scheduleSave();this.render()}
}

var VIEW_TYPE="simple-kanban-view";
class KanbanView extends obsidian.ItemView{
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.renderer=null;this.file=null}
  getViewType(){return VIEW_TYPE}
  getDisplayText(){if(!this.file)return"Kanban Board";var p=this.file.path;if(p.endsWith(".md"))p=p.slice(0,-3);return p}
  getIcon(){return"layout-dashboard"}
  getState(){var s=super.getState()||{};if(this.file)s.file=this.file.path;return s}
  async setState(state,result){await super.setState(state,result);if(state&&state.file){var f=this.app.vault.getAbstractFileByPath(state.file);if(f&&f instanceof obsidian.TFile)await this.setFile(f)}}
  async setFile(file){this.file=file;this.leaf.updateHeader();
    var leafEl=this.leaf.containerEl||this.contentEl.closest(".workspace-leaf");
    if(leafEl){var te=leafEl.querySelector(".view-header-title");if(te&&file)te.textContent=file.basename}
    if(this.renderer){this.renderer.file=file;await this.renderer.load()}}
  async onOpen(){var self=this,c=this.contentEl;c.empty();c.addClass("sk-view-container");
    this.renderer=new KanbanRenderer(c,this.plugin,this.file);if(this.file)await this.renderer.load();
    this.registerEvent(this.app.vault.on("modify",function(mf){if(self.file&&mf.path===self.file.path&&self.renderer)self.renderer.reload()}))}
  async onClose(){this.contentEl.empty()}
}

class SimpleKanbanPlugin extends obsidian.Plugin{
  async onload(){var self=this;await this.loadSettings();
    this.registerView(VIEW_TYPE,function(leaf){return new KanbanView(leaf,self)});
    this.addCommand({id:"open-as-kanban",name:"Open current note as Kanban board",callback:function(){self.toggleKanban()}});
    this.addRibbonIcon("layout-dashboard","Open as Kanban",function(){self.toggleKanban()});
    this.addSettingTab(new SettingsTab(this.app,this))}
  async loadSettings(){this.settings=Object.assign({},DEFAULT_SETTINGS,await this.loadData())}
  async saveSettings(){await this.saveData(this.settings)}
  async toggleKanban(){var file=this.app.workspace.getActiveFile();
    if(!file||file.extension!=="md"){new obsidian.Notice("Open a markdown file first.");return}
    var existing=this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for(var i=0;i<existing.length;i++){if(existing[i].view.file&&existing[i].view.file.path===file.path){existing[i].openFile(file);return}}
    var av=this.app.workspace.getActiveViewOfType(KanbanView);
    if(av&&av.file){var l=this.app.workspace.getLeaf("tab");await l.openFile(av.file);return}
    var leaf=this.app.workspace.getLeaf("tab");await leaf.setViewState({type:VIEW_TYPE,active:true,state:{file:file.path}});this.app.workspace.revealLeaf(leaf)}
  onunload(){}}

module.exports=SimpleKanbanPlugin;
