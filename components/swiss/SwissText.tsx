import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { swissTheme } from '@/constants/swissTheme';

interface SwissTextProps extends TextProps {
  variant?: 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'xs' | 'label' | 'caption';
  weight?: 'regular' | 'medium' | 'semibold';
  color?: keyof typeof swissTheme.colors.text | keyof typeof swissTheme.colors.gray | 'white' | 'error' | 'success' | 'warning' | 'accent';
  align?: 'auto' | 'left' | 'right' | 'center' | 'justify';
  numberOfLines?: number;
  children: React.ReactNode;
}

const SwissText = React.forwardRef<Text, SwissTextProps>(
  (
    {
      variant = 'body',
      weight = 'regular',
      color = 'primary',
      align = 'auto',
      numberOfLines,
      style,
      children,
      ...props
    },
    ref
  ) => {
    const getVariantStyles = () => {
      const theme = swissTheme;
      switch (variant) {
        case 'h1':
          return {
            fontSize: theme.typography.fontSize.xxxl, // 32px
            fontWeight: theme.typography.fontWeight.semibold,
            lineHeight: theme.typography.lineHeight.tight,
            letterSpacing: theme.typography.letterSpacing.tight,
          };
        case 'h2':
          return {
            fontSize: theme.typography.fontSize.xxl, // 24px
            fontWeight: theme.typography.fontWeight.semibold,
            lineHeight: theme.typography.lineHeight.tight,
            letterSpacing: theme.typography.letterSpacing.tight,
          };
        case 'h3':
          return {
            fontSize: theme.typography.fontSize.xl, // 20px
            fontWeight: theme.typography.fontWeight.semibold,
            lineHeight: theme.typography.lineHeight.normal,
            letterSpacing: theme.typography.letterSpacing.normal,
          };
        case 'body':
          return {
            fontSize: theme.typography.fontSize.base, // 16px
            fontWeight: theme.typography.fontWeight.regular,
            lineHeight: theme.typography.lineHeight.normal,
            letterSpacing: theme.typography.letterSpacing.normal,
          };
        case 'small':
          return {
            fontSize: theme.typography.fontSize.sm, // 14px
            fontWeight: theme.typography.fontWeight.regular,
            lineHeight: theme.typography.lineHeight.normal,
            letterSpacing: theme.typography.letterSpacing.normal,
          };
        case 'xs':
          return {
            fontSize: theme.typography.fontSize.xs, // 12px
            fontWeight: theme.typography.fontWeight.regular,
            lineHeight: theme.typography.lineHeight.tight,
            letterSpacing: theme.typography.letterSpacing.normal,
          };
        case 'label':
          return {
            fontSize: theme.typography.fontSize.sm, // 14px
            fontWeight: theme.typography.fontWeight.medium,
            lineHeight: theme.typography.lineHeight.normal,
            letterSpacing: theme.typography.letterSpacing.normal,
          };
        case 'caption':
          return {
            fontSize: theme.typography.fontSize.xs, // 12px
            fontWeight: theme.typography.fontWeight.regular,
            lineHeight: theme.typography.lineHeight.tight,
            letterSpacing: theme.typography.letterSpacing.wide,
          };
        default:
          return {
            fontSize: theme.typography.fontSize.base,
            fontWeight: theme.typography.fontWeight.regular,
            lineHeight: theme.typography.lineHeight.normal,
          };
      }
    };

    const getColorValue = () => {
      const theme = swissTheme;
      if (color === 'primary') return theme.colors.text.primary;
      if (color === 'secondary') return theme.colors.text.secondary;
      if (color === 'tertiary') return theme.colors.text.tertiary;
      if (color === 'inverted') return theme.colors.text.inverted;
      if (color === 'white') return theme.colors.white;
      if (color === 'error') return theme.colors.error;
      if (color === 'success') return theme.colors.success;
      if (color === 'warning') return theme.colors.warning;
      if (color === 'accent') return theme.colors.accent.primary;
      if (typeof color === 'string' && color in theme.colors.gray) {
        return theme.colors.gray[color as keyof typeof theme.colors.gray];
      }
      return theme.colors.text.primary;
    };

    const getWeightValue = () => {
      const weightMap = swissTheme.typography.fontWeight;
      return weightMap[weight];
    };

    const variantStyles = getVariantStyles();
    const textColor = getColorValue();
    const fontWeight = getWeightValue();

    const computedStyle = [
      {
        fontFamily: swissTheme.typography.fontFamily.primary,
        color: textColor,
        fontWeight,
        ...variantStyles,
        textAlign: align,
      },
      style,
    ];

    return (
      <Text
        ref={ref}
        style={computedStyle}
        numberOfLines={numberOfLines}
        allowFontScaling={false}
        {...props}
      >
        {children}
      </Text>
    );
  }
);

SwissText.displayName = 'SwissText';

export default SwissText;
