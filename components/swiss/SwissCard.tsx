import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { swissTheme } from '@/constants/swissTheme';

interface SwissCardProps extends ViewProps {
  variant?: 'default' | 'elevated';
  padding?: keyof typeof swissTheme.spacing;
  children: React.ReactNode;
}

const SwissCard = React.forwardRef<View, SwissCardProps>(
  ({ variant = 'default', padding = 4, style, children, ...props }, ref) => {
    const theme = swissTheme;
    const paddingValue = theme.spacing[padding as keyof typeof theme.spacing];

    const getVariantStyles = () => {
      switch (variant) {
        case 'elevated':
          return {
            backgroundColor: theme.colors.white,
            borderWidth: theme.borders.width.thin,
            borderColor: theme.colors.gray[200],
            ...theme.shadows.subtle,
          };
        case 'default':
        default:
          return {
            backgroundColor: theme.colors.surface,
            borderWidth: theme.borders.width.thin,
            borderColor: theme.colors.border,
          };
      }
    };

    const variantStyles = getVariantStyles();

    return (
      <View
        ref={ref}
        style={[
          {
            borderRadius: theme.borders.radius.md,
            padding: paddingValue,
            ...variantStyles,
          },
          style,
        ]}
        {...props}
      >
        {children}
      </View>
    );
  }
);

SwissCard.displayName = 'SwissCard';

export default SwissCard;
