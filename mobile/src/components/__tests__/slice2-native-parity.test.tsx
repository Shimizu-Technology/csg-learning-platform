import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CohortFileCard } from '@/components/cohort-file-card';
import { DriveFolderStrip } from '@/components/drive-controls';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { LoadingState } from '@/components/ui/loading-state';
import { isLearnerOverviewQuery, learningKeys } from '@/lib/learning';

const mockCohortFileVersions = jest.fn();
const mockDownloadCohortFile = jest.fn();

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('@/providers/session-provider', () => ({
  useSession: () => ({
    user: { id: 1, is_staff: true },
    api: {
      cohortFileVersions: mockCohortFileVersions,
      downloadCohortFile: mockDownloadCohortFile,
      previewCohortFile: jest.fn(),
    },
  }),
}));

describe('Slice 2 native feel & parity components', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders LoadingState skeleton variant with progressbar accessibility', () => {
    const view = render(<LoadingState variant="skeleton" label="Loading today" />);
    expect(view.getByLabelText('Loading today').props.accessibilityRole).toBe('progressbar');
  });

  it('renders BottomSheet with title and closes on close button tap', () => {
    const onClose = jest.fn();
    const view = render(
      <BottomSheet visible title="Rename folder" subtitle="Choose a new name" onClose={onClose}>
        <Text>Sheet body</Text>
      </BottomSheet>,
    );
    expect(view.getByText('Rename folder')).toBeTruthy();
    expect(view.getByText('Sheet body')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Close Rename folder' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes a rename button on DriveFolderStrip when inside a folder', () => {
    const onRenameFolder = jest.fn();
    const view = render(
      <DriveFolderStrip
        folders={[{ name: 'Slides', count: 3, needsReviewCount: 0, staffOnlyCount: 0 }]}
        activeFolder="Slides"
        rootLabel="Class files"
        onSelectFolder={jest.fn()}
        onRenameFolder={onRenameFolder}
      />,
    );
    fireEvent.press(view.getByRole('button', { name: 'Rename folder Slides' }));
    expect(onRenameFolder).toHaveBeenCalledWith('Slides');
  });

  it('loads file version history via api.cohortFileVersions inside CohortFileCard sheet', async () => {
    mockCohortFileVersions.mockResolvedValue({
      versions: [
        {
          id: 901,
          cohort_file_id: 42,
          version_number: 2,
          filename: 'slides-v2.pdf',
          content_type: 'application/pdf',
          file_size: 4096,
          note: 'Fixed typo',
          ready_at: '2026-11-26T00:00:00Z',
          uploaded_by_name: 'Leon Shimizu',
          current: true,
          preview_mode: 'pdf',
          previewable: true,
        },
        {
          id: 900,
          cohort_file_id: 42,
          version_number: 1,
          filename: 'slides-v1.pdf',
          content_type: 'application/pdf',
          file_size: 4000,
          note: null,
          ready_at: '2026-11-20T00:00:00Z',
          uploaded_by_name: 'Leon Shimizu',
          current: false,
          preview_mode: 'pdf',
          previewable: true,
        },
      ],
    });
    const file = {
      id: 42,
      cohort_id: 7,
      student_id: null,
      folder: 'Slides',
      visibility: 'students' as const,
      title: 'Week 2 Slides',
      description: null,
      filename: 'slides-v2.pdf',
      content_type: 'application/pdf',
      file_size: 4096,
      ready: true,
      ready_at: '2026-11-26T00:00:00Z',
      created_at: '2026-11-20T00:00:00Z',
      uploaded_by_name: 'Leon Shimizu',
      uploaded_by_role: 'staff' as const,
      can_manage: true,
      kind: 'file' as const,
      external_url: null,
      link_provider: null,
      version_number: 2,
      previewable: true,
      preview_mode: 'pdf' as const,
      auto_copy_to_students: false,
      doc_version: 0,
      doc_updated_at: null,
      doc_updated_by_name: null,
      can_edit_doc: false,
      review_status: 'none' as const,
      reviewed_by_name: null,
      reviewed_at: null,
      comment_count: 0,
      source_file_id: null,
      source_curriculum_file_id: null,
      source_cohort_file_id: null,
    };

    const view = render(<CohortFileCard cohortId={7} file={file} />);
    fireEvent.press(view.getByRole('button', { name: 'More actions for Week 2 Slides' }));
    fireEvent.press(view.getByText('Version history (v2)'));

    await waitFor(() => expect(mockCohortFileVersions).toHaveBeenCalledWith(7, 42, expect.anything()));
    expect(await view.findByText('v2 · Current')).toBeTruthy();
    expect(view.getByText('v1')).toBeTruthy();
  });

  it('includes courseOutline in learner overview invalidation', () => {
    expect(isLearnerOverviewQuery(learningKeys.courseOutline(12, 4), 12)).toBe(true);
    expect(isLearnerOverviewQuery(learningKeys.courseOutline(12, 4), 99)).toBe(false);
  });
});
