import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Divisions() {
  const { user } = useAuth();
  return (
    <CrudTable
      title="Divisions"
      endpoint="/divisions"
      canWrite={user.role === 'ADMIN'}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'description', label: 'Description' },
      ]}
      columns={[
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description', render: (r) => r.description || '—' },
      ]}
    />
  );
}
