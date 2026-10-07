import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import type { SettingsResource } from '@/lib/types';
import type { SectionProps } from './SettingsView';
import { useSave } from './useSave';
import { useStudio } from '@/features/studio/StudioContext';
import { ownerWords } from '@/features/studio/words';

export function ResourcesSection({ settings }: SectionProps) {
  const [name, setName] = useState('');
  const w = ownerWords(useStudio().kind);
  const save = useSave('owner_save_resource', (r: Partial<SettingsResource>) => ({ p_resource: r }));
  return (
    <VStack gap={3}>
      <Text color="secondary">{w.resourcesHint}</Text>
      {settings.resources.map((r) => (
        <ResourceRow key={r.id} r={r} onSave={(patch) => save.mutate({ id: r.id, ...patch })} busy={save.isPending} />
      ))}
      <Card padding={4}>
        <VStack gap={3}>
          <TextInput label={w.newResource} value={name} onChange={setName} placeholder={w.hasCar ? 'Бокс 3' : 'Мастер маникюра Айгерим'} width="100%" />
          <Button label={w.addResource} isDisabled={name.trim().length < 1} isLoading={save.isPending} onClick={() => save.mutate({ name: name.trim(), is_active: true }, { onSuccess: () => setName('') })} />
        </VStack>
      </Card>
    </VStack>
  );
}

function ResourceRow({ r, onSave, busy }: { r: SettingsResource; onSave: (p: Partial<SettingsResource>) => void; busy: boolean }) {
  const [name, setName] = useState(r.name);
  return (
    <Card padding={3}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="end">
          <TextInput label="Название" value={name} onChange={setName} width="100%" />
          <Button label="Сохранить" isDisabled={name.trim() === r.name || !name.trim()} isLoading={busy} onClick={() => onSave({ name: name.trim() })} />
        </HStack>
        <Switch label="Принимает записи" value={r.is_active} onChange={(v) => onSave({ is_active: v })} />
      </VStack>
    </Card>
  );
}
