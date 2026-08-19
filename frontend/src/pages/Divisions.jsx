import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Divisions() {
  const { user } = useAuth();
  return (
    <CrudTable
      title={
        <>
          Divisions{' '}
          <span className="text-base font-normal text-gray-500">(विभाग)</span>
        </>
      }
      // ?all=true so this management view also sees deactivated divisions
      // (needed to reactivate them) — every other consumer of GET /divisions
      // (e.g. picking one when creating a dealer/supplier) keeps seeing
      // active-only by default.
      endpoint="/divisions?all=true"
      canWrite={user.role === 'ORGANISATION'}
      editable
      activatable
      addButtonLabel="Add Division / विभाग जोडा"
      fields={[
        { key: 'name', label: 'Name / नाव', required: true },
        { key: 'description', label: 'Description / वर्णन' },
      ]}
      columns={[
        { key: 'id', label: 'ID / आयडी' },
        { key: 'name', label: 'Name / नाव' },
        { key: 'description', label: 'Description / वर्णन', render: (r) => r.description || '—' },
      ]}
    />
  );
}
