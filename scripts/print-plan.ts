/**
 * Prints a plan for one of the sample situations, in plain words.
 *
 *   npm run plan                          list the samples
 *   npm run plan -- bridal-gown           print its plan
 *   npm run plan -- bridal-gown bridal-gown-lace-late
 *                                         print the second plan, then what changed from the first
 *
 * The samples are the same data the tests run, so what she reads here is what is tested.
 */
import { diff, plan } from '../src/domain/engine';
import { ALL_FIXTURES } from '../src/domain/engine/fixtures';
import { renderDiff, renderPlan } from '../src/domain/engine/render';

const [firstName, secondName] = process.argv.slice(2);

function find(name: string) {
  const found = ALL_FIXTURES.find((f) => f.name === name);
  if (!found) {
    console.error(`No sample called "${name}". Choose one of: ${ALL_FIXTURES.map((f) => f.name).join(', ')}`);
    process.exit(1);
  }
  return found;
}

function run(name: string) {
  const fixture = find(name);
  const result = plan(fixture.input);
  if (!result.ok) {
    console.error(`The engine refused to plan "${fixture.name}":`);
    for (const e of result.errors) console.error(`  - ${e.message}`);
    process.exit(1);
  }
  return { fixture, plan: result.plan };
}

if (!firstName) {
  console.log('Samples:\n');
  for (const f of ALL_FIXTURES) console.log(`  ${f.name.padEnd(24)} ${f.title}`);
  console.log('\nRun one with:  npm run plan -- <name>');
} else {
  const first = run(firstName);
  if (!secondName) {
    console.log(`${first.fixture.title}\n${first.fixture.story}\n`);
    console.log(renderPlan(first.fixture.input, first.plan));
  } else {
    const second = run(secondName);
    console.log(`${second.fixture.title}\n${second.fixture.story}\n`);
    console.log(renderPlan(second.fixture.input, second.plan));
    console.log(`\n${renderDiff(second.fixture.input, diff(first.plan, second.plan))}`);
  }
}
