// 本文と、実際に扱える物理モデルを分けて教材を追加する。未対応の物理を自動生成しない。
import { el } from './common.js';
import { LAB_PRESETS, makeLabPlan } from './hybrid-lab.js';
import { checkedConfig } from './inquiry-data.js';
export function lessonImporter(useDraft) {
  const title=el('input',{type:'text',maxlength:60,'aria-label':'追加する教材の題名'});
  const text=el('textarea',{rows:5,maxlength:1000,'aria-label':'教材の本文',placeholder:'自分たちで用意した教材、または利用できる教科書等の本文を貼り付ける（1000字まで）'});
  const question=el('input',{type:'text',maxlength:80,'aria-label':'教材の最初の問い'});
  const source=el('input',{type:'text',maxlength:200,'aria-label':'教材の出典と利用条件',placeholder:'資料名・ページ・利用条件、またはチーム制作'});
  const model=el('select',{'aria-label':'教材で使う計算モデル'},...LAB_PRESETS.map(s=>el('option',{value:s.id},s.title)));
  let config=null;
  const status=el('p',{role:'status',class:'inq-message'}),file=el('input',{type:'file',accept:'.json,.txt,text/plain,application/json'});
  file.onchange=async()=>{try{
    const f=file.files[0];if(!f)return;if(f.size>100000)throw new Error('教材ファイルは100KB以内にしてください');
    const raw=await f.text();
    if(f.name.endsWith('.json')){const j=JSON.parse(raw);config=checkedConfig(j.config);title.value=String(j.title??'').slice(0,60);text.value=String(j.text??'').slice(0,1000);question.value=String(j.question??'').slice(0,80);source.value=[j.source,j.license].filter(Boolean).join(' / ').slice(0,200);model.value=LAB_PRESETS.find(x=>x.system===config.system).id;}
    else {text.value=raw.slice(0,1000);config=null;}
    status.textContent='下の本文・出典・モデルを確認して教材フォームに入れてください';
  }catch(e){status.textContent=e.message;}};
  model.onchange=()=>{config=null;};
  const button=el('button',{type:'button',class:'s2-btn',onclick:()=>{
    try{
      if(!title.value.trim()||!text.value.trim()||!question.value.trim()||!source.value.trim())throw new Error('題名・本文・問い・出典を入力してください');
      const c=checkedConfig(config??makeLabPlan(model.value).config);
      useDraft({material:{title:title.value.trim(),explanation:text.value.trim(),sim:{type:'cfg',config:c,goal:question.value.trim()},quiz:[],lesson:{question:question.value.trim(),predict:'条件を変える前に予想を書こう',check:'変えるものを1つ選び、ほかの条件をそろえて比べよう',result:'',summary:''}},model:'本文＋登録済みモデル（AI生成ではありません）',warnings:[],teacherNote:`出典・条件：${source.value.trim()}`}, {source:source.value.trim()});
      status.textContent='教材フォームに入れました。モデルが教材の現象を扱えるか確認し、配信してください';
    }catch(e){status.textContent=e.message;}
  }},'確認用の教材フォームに入れる');
  return el('details',{class:'inq-evidence'},el('summary',{},'教材の本文・JSONから、登録済みモデルで授業を追加'),
    el('p',{class:'s2-note'},'音・天体など同じモデルで扱える教材は、計算を作り直さず追加できます。PDFは必要な本文を貼り付けてください。式・図の自動読取はこの版の対象外です。'),file,
    el('label',{},'題名',title),el('label',{},'最初の問い',question),el('label',{},'教材の本文',text),el('label',{},'出典と利用条件',source),el('label',{},'実際に使う計算モデル',model),button,status);
}
