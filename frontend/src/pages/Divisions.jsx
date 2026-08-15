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
      endpoint="/divisions"
      canWrite={user.role === 'ADMIN'}
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
