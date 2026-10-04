// Points the site's IPNS name (served by w3name) at the latest IPFS build, so
// clifcode.eth's ENS content hash can stay fixed at ipns://<name>.
//
//   node scripts/ipns.mjs keygen          create a new name and print its key
//   node scripts/ipns.mjs publish <cid>   point the name at a new build
//   node scripts/ipns.mjs republish       re-sign the current value to keep it fresh
//
// publish and republish read the base64 key from the W3NAME_KEY env variable.
import * as Name from 'w3name';

const W3NAME_API = 'https://name.web3.storage';
// Gateways like eth.limo look IPNS names up on the IPFS network, which w3name
// doesn't reliably announce to, so hand the signed record to a public router too.
const ROUTING_API = 'https://delegated-ipfs.dev/routing/v1/ipns';

async function loadName() {
  const encoded = process.env.W3NAME_KEY?.trim();
  if (!encoded) throw new Error('W3NAME_KEY is not set');
  return Name.from(Buffer.from(encoded, 'base64'));
}

// w3name's resolve() only reports errors by message, so check for a
// never-published name directly instead of guessing from the error text.
async function isPublished(name) {
  const response = await fetch(`${W3NAME_API}/name/${name}`);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`w3name lookup failed with status ${response.status}`);
  return true;
}

async function announce(name) {
  const lookup = await fetch(`${W3NAME_API}/name/${name}`);
  if (!lookup.ok) throw new Error(`w3name lookup failed with status ${lookup.status}`);
  const { record } = await lookup.json();

  const response = await fetch(`${ROUTING_API}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/vnd.ipfs.ipns-record' },
    body: Buffer.from(record, 'base64')
  });
  if (!response.ok) throw new Error(`Announcing to ${ROUTING_API} failed with status ${response.status}`);
}

async function publish(value) {
  const name = await loadName();
  let revision;

  if (await isPublished(name)) {
    const current = await Name.resolve(name);
    revision = await Name.increment(current, value ?? current.value);
  } else {
    if (!value) throw new Error(`${name} has never been published; nothing to republish`);
    revision = await Name.v0(name, value);
  }

  await Name.publish(revision, name.key);

  const check = await Name.resolve(name);
  if (check.value !== revision.value) {
    throw new Error(`Published ${revision.value} but w3name returned ${check.value}`);
  }

  await announce(name);

  console.log(`IPNS_NAME=${name}`);
  console.log(`IPNS_VALUE=${revision.value}`);
  console.log(`IPNS_SEQUENCE=${revision.sequence}`);
  console.log(`ENS_CONTENT=ipns://${name}`);
}

async function keygen() {
  const name = await Name.create();
  console.log(`IPNS name (public, goes in ENS as ipns://<name>):\n  ${name}\n`);
  console.log(`W3NAME_KEY (secret, add as a GitHub Actions secret, never commit it):\n  ${Buffer.from(name.key.raw).toString('base64')}`);
}

const [command, cid] = process.argv.slice(2);

const run = {
  keygen,
  publish: () => {
    if (!cid) throw new Error('Usage: node scripts/ipns.mjs publish <cid>');
    return publish(`/ipfs/${cid}`);
  },
  republish: () => publish()
}[command];

if (!run) {
  console.error('Usage: node scripts/ipns.mjs <keygen|publish <cid>|republish>');
  process.exit(1);
}

Promise.resolve().then(run).catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
