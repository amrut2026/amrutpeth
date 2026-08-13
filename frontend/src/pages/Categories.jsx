import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Categories() {
  const { user } = useAuth();
  return (
    <CrudTable
      title={
        <>
          Product Categories{' '}
          <span className="text-base font-normal text-gray-500">(उत्पादन श्रेण्या)</span>
        </>
      }
      endpoint="/categories"
      canWrite={user.role === 'DEALER'}
      editable={user.role === 'DEALER'}
      addButtonLabel="Add Product Category"
      fields={[
        { key: 'name', label: 'Category Name', required: true },
        { key: 'description', label: 'Description' },
      ]}
      columns={[
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
        { key: 'dealer', label: 'Dealer', render: (r) => r.dealer?.name || '—' },
      ]}
    />
  );
}
