import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StatusBadgeProps {
  status: string;
  size?: 'small' | 'normal';
}

const statusColors: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#FFF3CD', text: '#856404' },
  accepted: { bg: '#D4EDDA', text: '#155724' },
  in_progress: { bg: '#CCE5FF', text: '#004085' },
  in_transit: { bg: '#CCE5FF', text: '#004085' },
  completed: { bg: '#D4EDDA', text: '#155724' },
  delivered: { bg: '#D4EDDA', text: '#155724' },
  failed: { bg: '#F8D7DA', text: '#721C24' },
  cancelled: { bg: '#F8D7DA', text: '#721C24' },
  planned: { bg: '#E2E3E5', text: '#383D41' },
  interested: { bg: '#D4EDDA', text: '#155724' },
  follow_up: { bg: '#CCE5FF', text: '#004085' },
  existing_customer: { bg: '#D4EDDA', text: '#155724' },
  new_lead: { bg: '#E2E3E5', text: '#383D41' },
  not_interested: { bg: '#F8D7DA', text: '#721C24' },
  arrived: { bg: '#D4EDDA', text: '#155724' },
  departed: { bg: '#CCE5FF', text: '#004085' },
  skipped: { bg: '#E2E3E5', text: '#383D41' },
  approved: { bg: '#D4EDDA', text: '#155724' },
  rejected: { bg: '#F8D7DA', text: '#721C24' },
  active: { bg: '#D4EDDA', text: '#155724' },
  inactive: { bg: '#E2E3E5', text: '#383D41' },
  high: { bg: '#F8D7DA', text: '#721C24' },
  medium: { bg: '#FFF3CD', text: '#856404' },
  low: { bg: '#E2E3E5', text: '#383D41' },
  urgent: { bg: '#DC3545', text: '#FFF' },
};

export default function StatusBadge({ status, size = 'normal' }: StatusBadgeProps) {
  const colors = statusColors[status] || { bg: '#E2E3E5', text: '#383D41' };

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.bg },
        size === 'small' && styles.badgeSmall,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: colors.text },
          size === 'small' && styles.textSmall,
        ]}
      >
        {status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  badgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  textSmall: {
    fontSize: 10,
  },
});