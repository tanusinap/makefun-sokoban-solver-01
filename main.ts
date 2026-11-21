// Golfed Sokoban solver v8: ultra-compact.
import{readFileSync,writeFileSync,mkdirSync}from"node:fs";
let D;
let F=(W,w,G,B,P,L)=>{
let s=new Set(),bk=[[[P,B,""]]],n=0,K=(p,b)=>{let k=p;for(let x of b)k=k*256+x;return k};
s.add(K(P,B));
for(let bi=0;bi<bk.length;bi++){let a=bk[bi];for(let i=0;i<a.length;i++){let[p,b,m]=a[i];if(""+b==""+G)return[m,p];for(let k=0;k<4;k++){let np=p+D[k];if(w[np])continue;let nb=b,mm=m+"udlr"[k],nn=bi,at=b.indexOf(np);if(at>=0){let t=np+D[k];if(w[t]||b.includes(t)||!L[t])continue;nb=[...b];nb[at]=t;nb.sort((x,y)=>x-y);mm=m+"UDLR"[k];nn=bi+1}let kk=K(np,nb);if(s.has(kk))continue;s.add(kk);if(++n>1e6)return 0;(bk[nn]||(bk[nn]=[])).push([np,nb,mm])}}}
return 0;
};
for(let i=1;i<6;i++){
let d="i00"+i,t=readFileSync("/input/"+d+"/level.txt","utf8"),W=t.indexOf("\n"),w=[],G=[],B=[],P,y=0,x=0;
for(let c of t){if(c=="\n"){y++;x=0;continue}let s=y*W+x++;w[s]=c=="#";if(".*+".includes(c))G.push(s);if("$*".includes(c))B.push(s);if("@+".includes(c))P=s}
B.sort((a,b)=>a-b);D=[-W,W,-1,1];
let L=[],q=[...G];
for(let g of G)L[g]=1;
for(let j=0;j<q.length;j++){let X=q[j];for(let dd of D){let Y=X-dd;if(!w[Y]&&!w[Y-dd]&&!L[Y]){L[Y]=1;q.push(Y)}}}
let r0=P/W|0,M="",pl=P,rem=[...B],w2=[...w];
while(rem.length){
let b0=rem[0],v=new Set([b0]),a=[b0];
for(let j=0;j<a.length;j++)for(let dd of D){let n=a[j]+dd;if(!w[n]&&(n/W|0)!==r0&&!v.has(n)){v.add(n);a.push(n)}}
let rb=rem.filter(z=>v.has(z)),rg=G.filter(z=>v.has(z)),w3=[...w2];
for(let z of rem)if(!v.has(z))w3[z]=1;
let z=F(W,w3,rg,rb,pl,L);
if(!z){M="";break}
M+=z[0];pl=z[1];rem=rem.filter(z=>!v.has(z));
for(let g of rg)w2[g]=1;
}
let o="/output/"+d;mkdirSync(o,{recursive:true});writeFileSync(o+"/solution.txt",M+"\n");
}
