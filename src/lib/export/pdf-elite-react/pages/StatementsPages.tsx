// pages/StatementsPages.tsx — Balance / Income / Cash Flow / Equity statements.
// Returns an array of <Page> elements (one per statement).
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { EditorialReport, ParsedTable } from '../types';
import {
  EditorialTitle,
  AuthorityChip,
  PaginationFooter,
} from '../primitives';
import { N0, N100, N300, N700, N1000, GOLD_500 } from '../tokens';

interface Props {
  doc: EditorialReport;
}

interface TableViewProps {
  table: ParsedTable;
}

/**
 * Inline table renderer for the financial statements. Equal-width columns,
 * subtle borders, emphasis for subtotals + totals (gold-tinted).
 */
function TableView({ table }: TableViewProps) {
  const colCount = table.headers.length;
  const colFlex = `${100 / colCount}%`;

  return (
    <View style={{ flexDirection: 'column' }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: N1000,
          paddingVertical: 6,
        }}
      >
        {table.headers.map((h, i) => (
          <View
            key={`hdr-${i}`}
            style={{ flexBasis: colFlex, paddingHorizontal: 6 }}
          >
            <Text
              style={{
                fontFamily: 'Geist',
                fontWeight: 700,
                fontSize: 8,
                color: N1000,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                textAlign: i === 0 ? 'left' : 'right',
              }}
            >
              {h}
            </Text>
          </View>
        ))}
      </View>

      {/* Rows */}
      {table.rows.map((row, ri) => {
        const isSubtotal = row.emphasis === 'subtotal';
        const isTotal = row.emphasis === 'total';
        const borderTopWidth = isTotal ? 1 : isSubtotal ? 0.5 : 0;
        const borderTopColor = isTotal ? N1000 : N300;
        const fontWeight = isTotal || isSubtotal ? 700 : 400;
        const color = isTotal ? GOLD_500 : N1000;
        const fontFamily = isTotal || isSubtotal ? 'Fraunces' : 'Geist';
        const bg =
          ri % 2 === 1 && !isTotal && !isSubtotal ? N100 : 'transparent';

        return (
          <View
            key={`row-${ri}`}
            style={{
              flexDirection: 'row',
              paddingVertical: 4,
              backgroundColor: bg,
              borderTopWidth,
              borderTopColor,
            }}
          >
            <View
              style={{ flexBasis: colFlex, paddingHorizontal: 6 }}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight,
                  fontSize: 9,
                  color,
                }}
              >
                {row.account}
              </Text>
            </View>
            {row.cells.map((cell, ci) => (
              <View
                key={`cell-${ri}-${ci}`}
                style={{ flexBasis: colFlex, paddingHorizontal: 6 }}
              >
                <Text
                  style={{
                    fontFamily: 'Geist Mono',
                    fontWeight: isTotal || isSubtotal ? 700 : 400,
                    fontSize: 9,
                    color: isTotal ? GOLD_500 : N1000,
                    textAlign: 'right',
                  }}
                >
                  {cell}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

interface StatementPageProps {
  table: ParsedTable;
  leadText: string;
  emphasisText: string;
  citationLabel: string;
}

function StatementPage({
  table,
  leadText,
  emphasisText,
  citationLabel,
}: StatementPageProps) {
  return (
    <Page
      size="A4"
      style={{
        backgroundColor: N0,
        paddingHorizontal: 48,
        paddingTop: 48,
        paddingBottom: 72,
      }}
    >
      <EditorialTitle
        leadText={leadText}
        emphasisText={emphasisText}
        emphasisStyle="box"
        areaAccent="valor"
        size="page"
        tone="dark-on-light"
      />

      <View
        style={{
          flexDirection: 'row',
          gap: 6,
          marginTop: 12,
          marginBottom: 20,
        }}
      >
        <AuthorityChip label={citationLabel} tone="midnight" />
      </View>

      {table.caption && (
        <Text
          style={{
            fontFamily: 'Geist',
            fontSize: 9,
            color: N700,
            marginBottom: 12,
            fontStyle: 'italic',
          }}
        >
          {table.caption}
        </Text>
      )}

      <View wrap>
        <TableView table={table} />
      </View>

      <PaginationFooter pageNumber={0} totalPages={0} sectionLabel={emphasisText} />
    </Page>
  );
}

/**
 * Returns an array of 4 <Page> elements: Balance, Income, Cash Flow, Equity.
 * The Document component spreads this into the <Document> children list.
 */
export function StatementsPages({ doc }: Props): React.ReactElement[] {
  return [
    <StatementPage
      key="balance"
      table={doc.statements.balance}
      leadText="Estado de"
      emphasisText="situación financiera"
      citationLabel="NIIF Secc. 4"
    />,
    <StatementPage
      key="income"
      table={doc.statements.income}
      leadText="Estado de"
      emphasisText="resultados"
      citationLabel="NIIF Secc. 5"
    />,
    <StatementPage
      key="cashflow"
      table={doc.statements.cashFlow}
      leadText="Estado de"
      emphasisText="flujos de efectivo"
      citationLabel="NIIF Secc. 7"
    />,
    <StatementPage
      key="equity"
      table={doc.statements.equity}
      leadText="Cambios en el"
      emphasisText="patrimonio"
      citationLabel="NIIF Secc. 6"
    />,
  ];
}

// Also export the inner page so the snapshot test can render a single statement.
export { StatementPage };
