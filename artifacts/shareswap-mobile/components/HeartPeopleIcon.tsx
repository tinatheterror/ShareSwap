import Svg, { Circle, Path } from "react-native-svg";

interface HeartPeopleIconProps {
  size?: number;
  color?: string;
}

export function HeartPeopleIcon({ size = 20, color = "#0f766e" }: HeartPeopleIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      <Circle cx="14.8" cy="10.4" r="1.55" fill="none" stroke="white" strokeWidth={0.9} />
      <Path
        d="M11.6 16.8 C11.6 14.3 13.0 13.0 14.8 13.0 C16.6 13.0 18.0 14.3 18.0 16.8"
        fill="none"
        stroke="white"
        strokeWidth={0.9}
        strokeLinecap="round"
      />
      <Circle cx="9.2" cy="10.4" r="1.55" fill="none" stroke="white" strokeWidth={0.9} />
      <Path
        d="M6.0 16.8 C6.0 14.3 7.4 13.0 9.2 13.0 C11.0 13.0 12.4 14.3 12.4 16.8"
        fill="none"
        stroke="white"
        strokeWidth={0.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}
