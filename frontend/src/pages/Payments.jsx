import CrudTable from '../components/CrudTable.jsx';

export default function Payments() {
  return (
    <CrudTable
      title={
        <>
          Payments to Manufacturer{' '}
          <span className="text-base font-normal text-gray-500">(उत्पादकाला देयके)</span>
        </>
      }
      endpoint="/payments"
      addButtonLabel="Add Payment to Manufacturer / उत्पादकाला देयक जोडा"
      fields={[
        { key: 'amount', label: 'Amount / रक्कम', type: 'number', required: true },
        { key: 'mode', label: 'Mode / पद्धत', type: 'select', required: true, options: [
          { value: 'CASH', label: 'CASH / रोख' }, { value: 'UPI', label: 'UPI / यूपीआय' }, { value: 'CARD', label: 'CARD / कार्ड' }
        ]},
        { key: 'reference', label: 'Reference / UTR (संदर्भ)' },
      ]}
      columns={[
        { key: 'id', label: '# / क्र.' },
        { key: 'amount', label: 'Amount / रक्कम', render: (r) => `₹${Number(r.amount).toFixed(2)}` },
        { key: 'mode', label: 'Mode / पद्धत' },
        { key: 'reference', label: 'Reference / संदर्भ' },
        { key: 'date', label: 'Date / दिनांक', render: (r) => new Date(r.date).toLocaleDateString() },
      ]}
    />
  );
}
