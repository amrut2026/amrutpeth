import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Suppliers() {
  const { user } = useAuth();
  return (
    <CrudTable
      title="Suppliers / Manufacturers"
      endpoint="/suppliers"
      canWrite={user.role === 'ADMIN'}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'address', label: 'Address', required: true },
        { key: 'contactNumber', label: 'Contact Number', required: true },
        { key: 'gstNumber', label: 'GST Number', required: true },
      ]}
      columns={[
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'address', label: 'Address' },
        { key: 'contactNumber', label: 'Contact' },
        { key: 'gstNumber', label: 'GST' },
      ]}
    />
  );
}
