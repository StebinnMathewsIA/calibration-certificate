/**
 * The reporting hierarchy as a nested tree (#147), owner reference: parent
 * rows with expand markers, children indented beneath a connecting line.
 *
 * The MANAGEMENT CHAIN is always visible: every manager node renders at
 * its level whether or not it holds a van, because the hierarchy is
 * structure, not stock, and hiding a vanless manager collapses the org
 * chart (#140). What toggles is each manager's own technician list, so an
 * admin sees the whole chain at a glance without a hundred technician
 * rows arriving at once.
 *
 * One component for both the stock tab and the admin allocation view, so
 * the two renderings of "who reports to whom" cannot drift apart. The
 * screens differ only in what tapping a technician does.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { AllocationManager } from '../api/client';
import { Badge, colors, fonts } from './ui';

type Technician = AllocationManager['technicians'][number];

function TechnicianRow({
  tech,
  onPress,
  showStock,
}: {
  tech: Technician;
  onPress: (tech: Technician) => void;
  showStock: boolean;
}) {
  const former = tech.rosterStatus === 'former';
  return (
    <Pressable
      onPress={() => onPress(tech)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${tech.technicianName ?? tech.staffCode}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        // Former technicians dim rather than vanish: the people looking
        // at this tree are exactly who need to see them (#141).
        opacity: former ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, color: colors.ink }}>
          {tech.technicianName ?? tech.staffCode}
        </Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>
          {tech.vanStatus === 'no_van'
            ? 'Holds no van stock'
            : tech.vanDescription ?? tech.vanCode ?? 'Van not set'}
        </Text>
      </View>
      {former ? (
        <Badge text="Former" tone="warn" />
      ) : showStock && tech.vanStatus === 'verified' ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            style={{
              fontFamily: fonts.bodyMedium,
              fontVariant: ['tabular-nums'],
              color: colors.ink,
            }}
          >
            {tech.inStock}
          </Text>
          <Text style={{ fontSize: 10, color: colors.muted }}>in stock</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ManagerNode({
  manager,
  childrenOf,
  open,
  toggle,
  onTechnicianPress,
  showStock,
  depth,
}: {
  manager: AllocationManager;
  childrenOf: Map<string, AllocationManager[]>;
  open: Record<string, boolean>;
  toggle: (email: string) => void;
  onTechnicianPress: (tech: Technician) => void;
  showStock: boolean;
  depth: number;
}) {
  const subManagers = childrenOf.get(manager.email.toLowerCase()) ?? [];
  const expanded = open[manager.email] ?? false;
  const hasTechs = manager.technicians.length > 0;

  return (
    <View>
      <Pressable
        onPress={() => hasTechs && toggle(manager.email)}
        accessibilityRole="button"
        accessibilityLabel={`${manager.name}, ${manager.technicians.length} technicians`}
        accessibilityState={{ expanded }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: depth === 0 ? 16 : 15,
            color: colors.navy,
            fontFamily: fonts.bodyMedium,
          }}
        >
          {manager.name}
        </Text>
        {hasTechs ? (
          <>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {manager.technicians.length} technician{manager.technicians.length === 1 ? '' : 's'}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{expanded ? '▴' : '▾'}</Text>
          </>
        ) : null}
      </Pressable>
      {/* The connecting line from the reference: children sit indented
          behind a single vertical rule, so the level structure reads
          without counting indents. */}
      <View style={{ marginLeft: 6, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: colors.line }}>
        {expanded
          ? manager.technicians.map((tech) => (
              <TechnicianRow
                key={tech.staffCode}
                tech={tech}
                onPress={onTechnicianPress}
                showStock={showStock}
              />
            ))
          : null}
        {subManagers.map((child) => (
          <ManagerNode
            key={child.email}
            manager={child}
            childrenOf={childrenOf}
            open={open}
            toggle={toggle}
            onTechnicianPress={onTechnicianPress}
            showStock={showStock}
            depth={depth + 1}
          />
        ))}
      </View>
    </View>
  );
}

export function ManagerTree({
  managers,
  onTechnicianPress,
  showStock = false,
}: {
  managers: AllocationManager[];
  onTechnicianPress: (tech: Technician) => void;
  /** Show the in-stock count on technician rows (the stock tab wants it,
   * the admin view does not). */
  showStock?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { roots, childrenOf } = useMemo(() => {
    const known = new Set(managers.map((m) => m.email.toLowerCase()));
    const children = new Map<string, AllocationManager[]>();
    const rootList: AllocationManager[] = [];
    const sorted = [...managers].sort((a, b) =>
      // Unallocated last at its level; otherwise by name, so the tree
      // reads like an org chart rather than an inbox.
      a.name === 'Unallocated' ? 1 : b.name === 'Unallocated' ? -1 : a.name.localeCompare(b.name),
    );
    for (const m of sorted) {
      const parent = m.reportsTo?.toLowerCase();
      if (parent && known.has(parent)) {
        const list = children.get(parent) ?? [];
        list.push(m);
        children.set(parent, list);
      } else {
        rootList.push(m);
      }
    }
    return { roots: rootList, childrenOf: children };
  }, [managers]);

  const toggle = (email: string) => setOpen((o) => ({ ...o, [email]: !(o[email] ?? false) }));

  return (
    <View>
      {roots.map((m) => (
        <ManagerNode
          key={m.email}
          manager={m}
          childrenOf={childrenOf}
          open={open}
          toggle={toggle}
          onTechnicianPress={onTechnicianPress}
          showStock={showStock}
          depth={0}
        />
      ))}
    </View>
  );
}
