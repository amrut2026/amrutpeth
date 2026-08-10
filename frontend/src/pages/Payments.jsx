import CrudTable from '../components/CrudTable.jsx';

export default function Payments() {
  return (
    <CrudTable
      title="Payments to Manufacturer"
      endpoint="/payments"
      fields={[
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        { key: 'mode', label: 'Mode', type: 'select', required: true, options: [
          { value: 'CASH', label: 'CASH' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'CARD' }
        ]},
        { key: 'reference', label: 'Reference / UTR' },
      ]}
      columns={[
        { key: 'id', label: '#' },
        { key: 'amount', label: 'Amount', render: (r) => `₹${Number(r.amount).toFixed(2)}` },
        { key: 'mode', label: 'Mode' },
        { key: 'reference', label: 'Reference' },
        { key: 'date', label: 'Date', render: (r) => new Date(r.date).toLocaleDateString() },
      ]}
    />
  );
}
