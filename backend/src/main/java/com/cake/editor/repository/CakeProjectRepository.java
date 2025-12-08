package com.cake.editor.repository;

import com.cake.editor.model.CakeProject;
import com.cake.editor.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CakeProjectRepository extends JpaRepository<CakeProject, Long> {
    List<CakeProject> findAllByOwnerOrderByUpdatedAtDesc(User owner);

    Optional<CakeProject> findByIdAndOwner(Long id, User owner);
}
