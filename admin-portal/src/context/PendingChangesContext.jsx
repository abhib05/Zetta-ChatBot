import React, { createContext, useState, useCallback } from 'react';

export const PendingChangesContext = createContext();

export const PendingChangesProvider = ({ children }) => {
  const [pendingChanges, setPendingChanges] = useState([]);

  const addChange = useCallback((change) => {
    setPendingChanges((prev) => [...prev, change]);
  }, []);

  const clearChanges = useCallback(() => {
    setPendingChanges([]);
  }, []);

  const isDirty = pendingChanges.length > 0;

  // The actual flushing logic is handled individually per page using flushChanges from the hook
  
  return (
    <PendingChangesContext.Provider
      value={{
        pendingChanges,
        isDirty,
        addChange,
        clearChanges
      }}
    >
      {children}
    </PendingChangesContext.Provider>
  );
};
