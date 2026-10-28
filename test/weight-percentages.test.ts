import {expect,test} from "vitest";
import {asPercentages,percentageWeights} from "../src/weight-percentages.js";
import {runInNewContext} from "node:vm";
import {dashboardJs} from "../src/dashboard-page.js";
test("relative weights display as percentages totaling 100 including thirds",()=>{
  expect(asPercentages([100,100,100])).toEqual([33.34,33.33,33.33]);
  expect(asPercentages([4,3,3])).toEqual([40,30,30]);
  expect(asPercentages([0,7,0])).toEqual([0,100,0]);
});
test("percentages require exactly 100 without rejecting valid decimal arithmetic",()=>{
  expect(percentageWeights([33.34,33.33,33.33])).toEqual([33.34,33.33,33.33]);
  expect(percentageWeights([0.1,0.2,99.7])).toEqual([0.1,0.2,99.7]);
  for(const weights of [[100,100,100],[1,2,3],[-1,1,100],[NaN,50,50],[Infinity,0,0],[33.333,33.333,33.334],[],[100,0],[100,0,"0"]])expect(()=>percentageWeights(weights)).toThrow();
});
test("dashboard disables Save and hides preview until percentages total 100",()=>{
  const nodes:Record<string,any>={};
  const document={getElementById:(id:string)=>nodes[id]??= {style:{},disabled:false,textContent:"",innerHTML:""},addEventListener:()=>{}};
  const source=dashboardJs.replace(/boot\(\);\s*$/,"");
  const context={document};
  runInNewContext(source+`;tab='weights';data={canManage:true,activity:{rows:[{author:'alice',merged:1,commits:1,reviews:1}]}};draftWeights=[100,100,100];updatePreview();`,context);
  expect(nodes['save-weights'].disabled).toBe(true);
  expect(nodes['weight-normalized'].textContent).toContain('300.00%');
  expect(nodes['weight-preview'].innerHTML).not.toContain('<table');
  runInNewContext(`draftWeights=[50,30,20];updatePreview();`,context);
  expect(nodes['save-weights'].disabled).toBe(false);
  expect(nodes['weight-normalized'].textContent).toContain('Ready to save');
});
