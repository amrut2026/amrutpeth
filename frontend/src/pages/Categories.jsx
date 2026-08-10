import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Categories() {
  const { user } = useAuth();
  return (
    <CrudTable
      title="Product Categories"
      endpoint="/categories"
      canWrite={user.role === 'ADMIN'}
      fields={[
        { key: 'name', label: 'Category Name', required: true },
        { key: 'description', label: 'Description' },
      ]}
      columns={[
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
      ]}
    />
  );
}
