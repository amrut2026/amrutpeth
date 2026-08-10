import { useEffect, useState } from 'react';
import api from '../api.js';

export default function RoleActivityMapping() {
  const [roles, setRoles] = useState([]);
  const [activities, setActivities] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [busyKey, setBusyKey] = useState(null);

  async function load() {
    const { data } = await api.get('/role-activity-mapping');
    setRoles(data.roles);
    setActivities(data.activities);
    setMappings(data.mappings);
  }
  useEffect(() => { load(); }, []);

  function findMapping(roleId, activityId) {
    return mappings.find((m) => m.roleId === roleId && m.activityId === activityId);
  }

  async function toggle(roleId, activityId) {
    const key = `${roleId}-${activityId}`;
    setBusyKey(key);
    const existing = findMapping(roleId, activityId);
    const nextActive = existing ? !existing.iactive : true;
    await api.post('/role-activity-mapping', { role_id: roleId, activity_id: activityId, iactive: nextActive });
    await load();
    setBusyKey(null);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Role &ndash; Activity Mapping</h1>
      <p className="text-gray-500 text-sm mb-4">
        Click a cell to grant / revoke a role's access to a module (activity). Green = active.
      </p>

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">Role \ Activity</th>
              {activities.map((a) => (
                <th key={a.activityId} className="text-left p-2 whitespace-nowrap">{a.activityName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.roleId} className="border-t">
                <td className="p-2 font-medium whitespace-nowrap">{r.roleName}</td>
                {activities.map((a) => {
                  const m = findMapping(r.roleId, a.activityId);
                  const active = m?.iactive;
                  const key = `${r.roleId}-${a.activityId}`;
                  return (
                    <td key={a.activityId} className="p-2">
                      <button
                        disabled={busyKey === key}
                        onClick={() => toggle(r.roleId, a.activityId)}
                        className={`w-8 h-8 rounded ${active ? 'bg-emerald-600' : 'bg-gray-200'} hover:opacity-80`}
                        title={active ? 'Active - click to revoke' : 'Inactive - click to grant'}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {roles.length === 0 && (
              <tr><td className="p-3 text-gray-400" colSpan={activities.length + 1}>No roles found. Run the seed script.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
