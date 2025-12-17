import React, { useState } from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
  StyleSheet,
} from 'react-native';
import { swissTheme } from '@/constants/swissTheme';

interface SwissInputProps extends TextInputProps {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  containerStyle?: ViewStyle;
}

const SwissInput = React.forwardRef<TextInput, SwissInputProps>(
  (
    {
      label,
      error,
      icon,
      fullWidth = true,
      containerStyle,
      onFocus,
      onBlur,
      ...props
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);

    const handleFocus = (e: any) => {
      setIsFocused(true);
      onFocus?.(e);
    };

    const handleBlur = (e: any) => {
      setIsFocused(false);
      onBlur?.(e);
    };

    const theme = swissTheme;

    const borderColor = error
      ? theme.colors.error
      : isFocused
      ? theme.colors.accent.primary
      : theme.colors.gray[300];

    return (
      <View style={[fullWidth && { flex: 1 }, containerStyle]}>
        {label && (
          <SwissLabel style={{ marginBottom: theme.spacing[2] }}>
            {label}
          </SwissLabel>
        )}
        <View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              borderWidth: theme.borders.width.thin,
              borderColor,
              borderRadius: theme.borders.radius.md,
              paddingHorizontal: theme.spacing[3],
              backgroundColor: theme.colors.white,
              height: 44,
              transition: 'border-color 150ms ease-out',
            },
          ]}
        >
          {icon && <View style={{ marginRight: theme.spacing[2] }}>{icon}</View>}
          <TextInput
            ref={ref}
            style={[
              {
                flex: 1,
                fontFamily: theme.typography.fontFamily.primary,
                fontSize: theme.typography.fontSize.base,
                fontWeight: theme.typography.fontWeight.regular,
                color: theme.colors.text.primary,
                padding: 0,
              },
            ]}
            placeholderTextColor={theme.colors.text.tertiary}
            onFocus={handleFocus}
            onBlur={handleBlur}
            allowFontScaling={false}
            {...props}
          />
        </View>
        {error && (
          <SwissLabel
            style={{
              marginTop: theme.spacing[1],
              color: theme.colors.error,
            }}
            color="error"
          >
            {error}
          </SwissLabel>
        )}
      </View>
    );
  }
);

// Companion component for labels
const SwissLabel = React.forwardRef<React.ComponentType<any>, any>(
  ({ children, style, color = 'secondary', ...props }, ref) => {
    const theme = swissTheme;
    return (
      <View
        style={[
          {
            fontFamily: theme.typography.fontFamily.primary,
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.medium,
            color: color === 'error' ? theme.colors.error : theme.colors.text.secondary,
          },
          style,
        ]}
        {...props}
      >
        {typeof children === 'string' ? (
          <Text style={{ fontSize: 14, fontWeight: '500', color: color === 'error' ? theme.colors.error : theme.colors.text.secondary }}>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    );
  }
);

import { Text } from 'react-native';

SwissInput.displayName = 'SwissInput';
SwissLabel.displayName = 'SwissLabel';

export default SwissInput;
export { SwissLabel };
