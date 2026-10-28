import type {Weights} from "./activity-share.js";

// Existing command/environment settings remain relative. Present them in the
// dashboard as percentages whose displayed hundredths add up to exactly 100.
export function asPercentages(weights: Weights): Weights {
  const sum=weights.reduce((a,b)=>a+b,0);
  const parts=weights.map((w,i)=>({i, exact:w/sum*10000, units:Math.floor(w/sum*10000)}));
  const remaining=10000-parts.reduce((n,p)=>n+p.units,0);
  const ranked=[...parts].sort((a,b)=>(b.exact-b.units)-(a.exact-a.units)||a.i-b.i);
  for(let i=0;i<remaining;i++)ranked[i%ranked.length].units++;
  return parts.map(p=>p.units/100) as Weights;
}

export function percentageWeights(input: unknown): Weights {
  if(!Array.isArray(input)||input.length!==3||input.some(v=>typeof v!=="number"||!Number.isFinite(v)||v<0||v>100||Math.abs(v*100-Math.round(v*100))>0.000001)||
    Math.abs(input.reduce((sum,v)=>sum+v,0)-100)>0.000001) {
    throw new Error("Enter three percentages between 0 and 100, with up to two decimal places, totaling exactly 100%.");
  }
  return input as Weights;
}
