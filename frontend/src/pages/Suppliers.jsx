import CrudTable from '../components/CrudTable.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Suppliers() {
  const { user } = useAuth();

  return (
    <CrudTable
      title={
        <span>
          Suppliers / Manufacturers
          <span className="block text-xs font-normal text-orange-700">पुरवठादार / उत्पादक</span>
        </span>
      }
      endpoint="/suppliers"
      canWrite={user.role === 'DEALER'}
      editable
      fields={[
        { key: 'name', label: 'Name / नाव', required: true },
        { key: 'address', label: 'Address / पत्ता', required: true },
        { key: 'contactNumber', label: 'Contact Number / संपर्क क्रमांक', required: true },
        { key: 'gstNumber', label: 'GST Number (optional) / GST क्रमांक (ऐच्छिक)' },
        // No divisionId/dealerId field here — the backend always assigns a
        // new supplier to the logged-in dealer's own id (see
        // suppliers.js POST /), so it's not something to pick in this form.
        { key: 'bankAccounts', label: 'Bank accounts / बँक खाती', type: 'bankAccounts' },
      ]}
      columns={[
        { key: 'id', label: 'ID / आयडी' },
        { key: 'name', label: 'Name / नाव' },
        { key: 'address', label: 'Address / पत्ता' },
        { key: 'contactNumber', label: 'Contact / संपर्क' },
        { key: 'gstNumber', label: 'GST' },
        {
          key: 'bankAccounts',
          label: 'Bank Accounts / बँक खाती',
          render: (r) => r.bankAccounts?.map((b) => `${b.bankName} - ${b.accountNumber} (${b.ifsc})`).join(' | ') || 'None',
        },
      ]}
    />
  );
}
