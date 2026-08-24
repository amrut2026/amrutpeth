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
      addButtonLabel="Add Product Category / उत्पादन श्रेणी जोडा"
      fields={[
        { key: 'name', label: 'Category Name / श्रेणीचे नाव', required: true },
        { key: 'description', label: 'Description / वर्णन' },
        // Optional — left blank, the backend applies the schema default of
        // 2.5% each (see schema.prisma ProductCategory.cgst/sgst).
        {
          key: 'gst',
          label: 'CGST % / SGST % (default 2.5 each) / सीजीएसटी % / एसजीएसटी %',
          type: 'group',
          fields: [
            { key: 'cgst', label: 'CGST %', type: 'number' },
            { key: 'sgst', label: 'SGST %', type: 'number' },
          ],
        },
      ]}
      columns={[
        { key: 'id', label: 'ID / आयडी' },
        { key: 'name', label: 'Name / नाव' },
        { key: 'description', label: 'Description / वर्णन' },
        { key: 'cgst', label: 'CGST % / सीजीएसटी %' },
        { key: 'sgst', label: 'SGST % / एसजीएसटी %' },
        { key: 'dealer', label: 'Dealer / डीलर', render: (r) => r.dealer?.name || '—' },
      ]}
    />
  );
}
