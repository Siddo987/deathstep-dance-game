import{c as o}from"./index-Dnkk0cz0.js";/**
 * @license lucide-react v0.378.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const a=o("Smartphone",[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]);/**
 * @license lucide-react v0.378.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=o("Timer",[["line",{x1:"10",x2:"14",y1:"2",y2:"2",key:"14vaq8"}],["line",{x1:"12",x2:"15",y1:"14",y2:"11",key:"17fdiu"}],["circle",{cx:"12",cy:"14",r:"8",key:"1e1u0o"}]]);function h(c){const n=[];for(const e of c){const t=n[n.length-1];if(t&&t.kills===e.kills)t.entries.push(e);else{const s=n.reduce((l,r)=>l+r.entries.length,0)+1;n.push({kills:e.kills,entries:[e],startRank:s})}}return n.flatMap(({entries:e,startRank:t})=>{const s=t+e.length-1,l=e.length>=3?`#${t}-#${s}`:`#${t}`;return e.map(r=>({...r,rankLabel:l}))})}export{a as S,y as T,h as b};
