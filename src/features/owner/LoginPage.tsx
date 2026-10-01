import { useState, type FormEvent } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Center } from '@astryxdesign/core/Center';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { errorMessage } from '@/lib/errors';
import { useStudio } from '@/features/studio/StudioContext';
import { studioPath } from '@/features/studio/paths';
import { signIn } from './auth';

/** Email + password only. Owner accounts are created by the platform, there is no sign-up. */
export function LoginPage() {
  const studio = useStudio();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center minHeight="100dvh" padding={4}>
      <Card width="100%" maxWidth={400} padding={6}>
        <form onSubmit={submit}>
          <VStack gap={4}>
            <VStack gap={1}>
              <Heading level={1}>Кабинет студии</Heading>
              <Text color="secondary">{studio.name}</Text>
            </VStack>
            <TextInput label="Почта" type="email" value={email} onChange={setEmail} autoComplete="username" isRequired width="100%" hasAutoFocus />
            <TextInput label="Пароль" type="password" value={password} onChange={setPassword} autoComplete="current-password" isRequired width="100%" />
            {error ? <Banner status="error" title={errorMessage(error)} collapsible={false} /> : null}
            <Button type="submit" variant="primary" size="lg" label="Войти" isLoading={busy} isDisabled={!email || !password} width="100%" />
            <Text type="supporting">Доступ выдаёт администратор платформы. Если забыли пароль, напишите ему.</Text>
            <Button variant="ghost" label="На страницу студии" href={studioPath(studio.slug)} />
          </VStack>
        </form>
      </Card>
    </Center>
  );
}
