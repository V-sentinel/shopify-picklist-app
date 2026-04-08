import React, { useState } from 'react';
import {
  Banner,
  Button,
  Frame,
  Layout,
  Page,
  Text,
  Toast,
} from '@shopify/polaris';
import { useActionExtensionApi } from '@shopify/ui-extensions-react/admin';

export default function App() {
  const { data, close, query } = useActionExtensionApi();
  const [loading, setLoading] = useState(false);
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const selectedOrderIds = data.selected?.map(item => item.id) || [];
  const orderCount = selectedOrderIds.length;

  const handleCreatePicklists = async () => {
    setLoading(true);
    
    try {
      // Extract just the numeric IDs from GraphQL IDs
      const orderNumbers = selectedOrderIds.map(id => {
        const match = id.match(/\d+$/);
        return match ? match[0] : null;
      }).filter(Boolean);
      
      // Call your backend using authenticated fetch
      const response = await fetch('/api/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: orderNumbers })
      });
      
      if (response.ok) {
        setToastMessage(`✅ Created picklists for ${orderCount} order(s)`);
        setToastActive(true);
        setTimeout(() => close(), 2000);
      } else {
        throw new Error('Failed to create picklists');
      }
    } catch (error) {
      setToastMessage(`❌ Error: ${error.message}`);
      setToastActive(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Frame>
      <Page>
        <Layout>
          <Layout.Section>
            <div style={{ padding: '20px' }}>
              <Text variant="headingLg" as="h1">
                📦 Create Picklists
              </Text>
              <div style={{ marginTop: '16px' }}>
                <Banner tone="info">
                  {orderCount === 0 ? (
                    "No orders selected"
                  ) : (
                    `Create picklists for ${orderCount} selected order(s)`
                  )}
                </Banner>
              </div>
              <div style={{ marginTop: '24px' }}>
                <Button
                  primary
                  loading={loading}
                  disabled={orderCount === 0}
                  onClick={handleCreatePicklists}
                >
                  Create Picklists
                </Button>
              </div>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
      {toastActive && (
        <Toast content={toastMessage} onDismiss={() => setToastActive(false)} />
      )}
    </Frame>
  );
}
