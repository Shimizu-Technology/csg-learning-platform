import { Redirect, type Href } from 'expo-router';
export default function NotFound() { return <Redirect href={'/link-unavailable' as Href} />; }
