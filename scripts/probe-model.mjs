import {runModel} from '../server/model.mjs';
import path from 'node:path';
const schema={type:'object',additionalProperties:false,properties:{grossCents:{type:'integer'},netCents:{type:'integer'},paymentCount:{type:'integer'},statement:{type:'string'}},required:['grossCents','netCents','paymentCount','statement']};
const r=await runModel({prompt:'Return only the structured result. Do not use tools. Synthetic source: one additional payroll correction is gross $60, withholding $12, net $48. A matching bank credit of $48 carries the same trace ID. Count the economic correction once. Extract gross and net in cents, paymentCount, and a brief statement that this does not establish full claim resolution.',schema,jobDir:path.resolve('work/model-probe')});
if(r.analysis.grossCents!==6000||r.analysis.netCents!==4800||r.analysis.paymentCount!==1)throw new Error('Probe interpretation failed');
console.log(JSON.stringify(r));
