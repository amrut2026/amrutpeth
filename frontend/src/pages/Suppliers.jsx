import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Suppliers() {
  const { user } = useAuth();

  return (
    <CrudTable
      title="Suppliers / Manufacturers"
      endpoint="/suppliers"
      canWrite={user.role === 'DEALER'}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'address', label: 'Address', required: true },
        { key: 'contactNumber', label: 'Contact Number', required: true },
        { key: 'gstNumber', label: 'GST Number (optional)' },
        // No divisionId field here — the backend always assigns a new
        // supplier to the logged-in dealer's own division (see
        // suppliers.js POST /), so it's not something to pick in this form.
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
