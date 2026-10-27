import type { DB } from '../database/index.js';
import { authorize, event, version, type Actor } from './services.js';
import { requireRule } from './index.js';
import { companyConfiguration } from '../contracts/index.js';

export async function configuration(t:DB, a:Actor, lock=false) {
  const row=(await t.query('SELECT * FROM company_configuration WHERE org_id=$1'+(lock?' FOR UPDATE':''),[a.org_id])).rows[0];
  requireRule(row,'CONFIGURATION_REQUIRED','An administrator must initialise company settings',409);
  return row;
}
export async function configureCompany(t:DB, a:Actor, payload:unknown) {
  authorize(a,'configure');
  const p=companyConfiguration.parse(payload), old=await configuration(t,a,true);
  version(old,p.expectedVersion);
  if(p.section==='identity') {
    // 3PL is recorded as an intended profile, never enables unimplemented ownership workflows.
    await t.query('UPDATE company_configuration SET display_name=$1,operating_profile=$2,identity_reviewed=true WHERE org_id=$3',[p.displayName,p.operatingProfile,a.org_id]);
    await t.query('UPDATE organizations SET name=$1 WHERE id=$2',[p.displayName,a.org_id]);
  } else if(p.section==='locale') {
    await t.query('UPDATE company_configuration SET timezone=$1,language=$2,date_format=$3,locale_reviewed=true WHERE org_id=$4',[p.timezone,p.language,p.dateFormat,a.org_id]);
  } else {
    await t.query('UPDATE company_configuration SET preparation_weekdays=$1,schedule_reviewed=true WHERE org_id=$2',[p.preparationWeekdays,a.org_id]);
  }
  await t.query('UPDATE company_configuration SET version=version+1,updated_at=now() WHERE org_id=$1',[a.org_id]);
  const current=await configuration(t,a);
  await t.query(`INSERT INTO company_configuration_revisions(org_id,version,section,actor_id,reason,display_name,timezone,language,date_format,operating_profile,preparation_weekdays,identity_reviewed,locale_reviewed,schedule_reviewed)
    SELECT org_id,version,$2,$3,$4,display_name,timezone,language,date_format,operating_profile,preparation_weekdays,identity_reviewed,locale_reviewed,schedule_reviewed FROM company_configuration WHERE org_id=$1`,[a.org_id,p.section,a.id,p.reason]);
  await event(t,a,a.org_id,'company.configuration_changed',{section:p.section,previous:old,current,reason:p.reason});
  return current;
}
