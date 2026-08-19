import { useEffect, useState } from 'react';
import api from '../api.js';
import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Suppliers() {
  const { user } = useAuth();
  const [divisions, setDivisions] = useState([]);

  useEffect(() => {
    api.get('/divisions').then(({ data }) => setDivisions(data));
  }, []);

  return (
    <CrudTable
      title="Suppliers / Manufacturers"
      endpoint="/suppliers"
      canWrite={user.role === 'ORGANISATION'}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'address', label: 'Address', required: true },
        { key: 'contactNumber', label: 'Contact Number', required: true },
        { key: 'gstNumber', label: 'GST Number', required: true },
        {
          key: 'divisionId',
          label: 'Division',
          type: 'select',
          required: true,
          options: divisions.map((d) => ({ value: d.id, label: d.name })),
        },
        { key: 'bankAccounts', label: 'Bank accounts', type: 'bankAccounts' },
      ]}
      columns={[
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
        { key: 'address', label: 'Address' },
        { key: 'contactNumber', label: 'Contact' },
        { key: 'gstNumber', label: 'GST' },
        { key: 'division', label: 'Division', render: (r) => r.division?.name || '—' },
        {
          key: 'bankAccounts',
          label: 'Bank Accounts',
          render: (r) => r.bankAccounts?.map((b) => `${b.bankName} - ${b.accountNumber} (${b.ifsc})`).join(' | ') || 'None',
        },
      ]}
    />
  );
}
