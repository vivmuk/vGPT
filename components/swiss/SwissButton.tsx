import React from 'react';
import {
  TouchableOpacity,
  TouchableOpacityProps,
  StyleSheet,
  ViewStyle,
  View,
} from 'react-native';
import { swissTheme } from '@/constants/swissTheme';
import SwissText from './SwissText';

interface SwissButtonProps extends Omit<TouchableOpacityProps, 'style'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  style?: ViewStyle;
  children: React.ReactNode;
  disabled?: boolean;
}

const SwissButton = React.forwardRef<TouchableOpacity, SwissButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      icon,
      iconPosition = 'left',
      fullWidth = false,
      style,
      children,
      disabled = false,
      activeOpacity = 0.8,
      ...props
    },
    ref
  ) => {
    const getSizeStyles = () => {
      const theme = swissTheme;
      switch (size) {
        case 'sm':
          return {
            height: 36,
            paddingHorizontal: theme.spacing[3],
            paddingVertical: theme.spacing[1],
          };
        case 'md':
          return {
            height: 44,
            paddingHorizontal: theme.spacing[4],
            paddingVertical: theme.spacing[2],
          };
        case 'lg':
          return {
            height: 52,
            paddingHorizontal: theme.spacing[6],
            paddingVertical: theme.spacing[3],
          };
        default:
          return {
            height: 44,
            paddingHorizontal: theme.spacing[4],
            paddingVertical: theme.spacing[2],
          };
      }
    };

    const getVariantStyles = () => {
      const theme = swissTheme;
      const baseStyle = {
        borderRadius: theme.borders.radius.md,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        flexDirection: 'row' as const,
      };

      switch (variant) {
        case 'primary':
          return {
            ...baseStyle,
            backgroundColor: disabled ? theme.colors.gray[200] : theme.colors.accent.primary,
          };
        case 'secondary':
          return {
            ...baseStyle,
            backgroundColor: theme.colors.gray[100],
            borderWidth: theme.borders.width.thin,
            borderColor: theme.colors.gray[300],
          };
        case 'ghost':
          return {
            ...baseStyle,
            backgroundColor: 'transparent',
            borderWidth: theme.borders.width.thin,
            borderColor: theme.colors.gray[300],
          };
        case 'danger':
          return {
            ...baseStyle,
            backgroundColor: disabled ? theme.colors.gray[200] : theme.colors.error,
          };
        default:
          return baseStyle;
      }
    };

    const getTextColor = () => {
      if (disabled) return 'tertiary';
      switch (variant) {
        case 'primary':
        case 'danger':
          return 'inverted';
        case 'secondary':
        case 'ghost':
          return 'primary';
        default:
          return 'primary';
      }
    };

    const sizeStyles = getSizeStyles();
    const variantStyles = getVariantStyles();
    const textColor = getTextColor();

    return (
      <TouchableOpacity
        ref={ref}
        style={[
          sizeStyles,
          variantStyles,
          fullWidth && { flex: 1 },
          { opacity: disabled ? 0.6 : 1 },
          style,
        ]}
        activeOpacity={activeOpacity}
        disabled={disabled}
        {...props}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: swissTheme.spacing[2] }}>
          {icon && iconPosition === 'left' && icon}
          <SwissText
            variant="small"
            weight="medium"
            color={textColor}
            numberOfLines={1}
          >
            {children}
          </SwissText>
          {icon && iconPosition === 'right' && icon}
        </View>
      </TouchableOpacity>
    );
  }
);

SwissButton.displayName = 'SwissButton';

export default SwissButton;
