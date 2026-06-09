/**
 * `atlas actual show <staffId>` — view a single staff member's actual hours detail.
 *
 * Shows the weekly breakdown for a specific person.
 */
import { getClientOrExit } from '../_client.js';
import { fetchManpowerConfirm } from '../_manhours.js';
import { resolveProjectIdAsync } from '../../util/projectId.js';
import { ConfigError } from '../../util/errors.js';
import { printResult, isJsonMode } from '../../util/output.js';
import {
  flattenManpowerTree,
} from '../_actual_logic.js';
import { loadSession } from '../../auth/session.js';

export interface ActualShowCmdOpts {
  readonly projectId?: string;
  readonly month?: string;
  readonly refreshProjects?: boolean;
  readonly json?: boolean;
}

function getCurrentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function showCmd(staffId: string, opts: ActualShowCmdOpts): Promise<void> {
  const client = await getClientOrExit();
  const session = await loadSession();
  if (!session) {
    throw new ConfigError('No session. Run `atlas auth login` first.');
  }

  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;
  const month = opts.month ?? getCurrentMonth();

  const [pendingResult, approvedResult] = await Promise.all([
    fetchManpowerConfirm(client, {
      projectId,
      month,
      staffId: session.empId,
      status: 0,
    }),
    fetchManpowerConfirm(client, {
      projectId,
      month,
      staffId: session.empId,
      status: 1,
    }),
  ]);

  const pendingRows = flattenManpowerTree(pendingResult.teamMp ?? [], '', '', 0);
  const approvedRows = flattenManpowerTree(approvedResult.teamMp ?? [], '', '', 1);

  // Merge, approved overwrites pending
  const staffMap = new Map<string, typeof pendingRows[number]>();
  for (const row of pendingRows) staffMap.set(row.staffId, row);
  for (const row of approvedRows) staffMap.set(row.staffId, row);

  const match = staffMap.get(staffId);
  if (!match) {
    if (isJsonMode({ json: opts.json })) {
      printResult(
        { found: false, staffId, projectId, month },
        { json: opts.json, hint: 'Staff not found in this project.' },
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(`Staff ${staffId} not found in project ${projectId} for month ${month}.`);
    }
    process.exitCode = 2;
    return;
  }

  printResult(
    {
      found: true,
      staffId: match.staffId,
      staffName: match.staffName,
      role: match.role,
      teamLeadId: match.teamLeadId,
      teamLeadName: match.teamLeadName,
      status: match.status === 1 ? 'approved' : 'pending',
      total: match.total,
      headcount: match.headcount,
      weeks: match.weeks,
    },
    {
      json: opts.json,
      meta: { projectId, month },
      renderHuman: () => {
        // eslint-disable-next-line no-console
        console.log(`Staff: ${match.staffName} (${match.staffId})`);
        // eslint-disable-next-line no-console
        console.log(`Role: ${match.role}`);
        // eslint-disable-next-line no-console
        console.log(`Team: ${match.teamLeadName} (${match.teamLeadId})`);
        // eslint-disable-next-line no-console
        console.log(`Status: ${match.status === 1 ? 'approved' : 'pending'}`);
        // eslint-disable-next-line no-console
        console.log(`Total (人月): ${match.total.toFixed(2)}`);
        // eslint-disable-next-line no-console
        console.log(`Headcount: ${match.headcount}`);
        // eslint-disable-next-line no-console
        console.log(`Month: ${month}`);
        if (match.weeks.length > 0) {
          // eslint-disable-next-line no-console
          console.log('\nWeekly breakdown:');
          for (const w of match.weeks) {
            // eslint-disable-next-line no-console
            console.log(`  ${w.remark ?? ''}: ${w.manpower}h`);
          }
        }
      },
    },
  );
}