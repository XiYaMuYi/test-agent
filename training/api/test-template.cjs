const { Pool } = require('pg');
const crypto = require('crypto');

function deriveLearnerId(principalId) {
  const digest = crypto.createHash('sha256').update('learner:' + principalId).digest('hex');
  return digest.slice(0,8) + '-' + digest.slice(8,12) + '-5' + digest.slice(13,16) + '-' + ((parseInt(digest.slice(16,18),16) & 0x3f | 0x80).toString(16)) + digest.slice(18,20) + '-' + digest.slice(20,32);
}

const pool = new Pool({ connectionString: 'postgresql://training:training@localhost:5432/training' });

const principal = {
  principalId: 'streamer-001',
  organizationId: '11111111-1111-1111-1111-111111111111'
};

async function test() {
  const learnerId = deriveLearnerId(principal.principalId);
  console.log('learnerId:', learnerId);

  const conditions = [
    "t.status = 'active'",
    "(t.scope = 'platform' OR (t.scope = 'organization' AND t.organization_id = $1) OR (t.scope = 'personal' AND t.owner_learner_id = $2))"
  ];
  const values = [principal.organizationId, learnerId];
  values.push('personal');
  conditions.push('t.scope = $3');

  const query = 'SELECT t.id, t.organization_id, t.scope, t.owner_learner_id, t.title, t.persona_config, t.knowledge_versions, t.scoring_rules, t.agent_config, t.status, t.created_at FROM training_template t WHERE ' + conditions.join(' AND ') + ' ORDER BY t.scope ASC, t.created_at DESC';

  console.log('Query:', query);
  console.log('Values:', values);

  const result = await pool.query(query, values);
  console.log('Result rows:', result.rows.length);
  await pool.end();
}

test().catch(e => { console.error('Error:', e.message, e.code); pool.end(); });
